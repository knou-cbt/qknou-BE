import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { UpdateNotice } from './entities/update-notice.entity';
import { UpdateEntry } from './entities/update-entry.entity';
import { DiscordNotifyService } from 'src/notifications/discord-notify.service';

/** 발행 시 노출 기간 (고정 7일) */
const EXPOSE_DAYS = 7;

@Injectable()
export class NoticesService {
  constructor(
    @InjectRepository(UpdateNotice)
    private noticeRepository: Repository<UpdateNotice>,
    @InjectRepository(UpdateEntry)
    private entryRepository: Repository<UpdateEntry>,
    private dataSource: DataSource,
    private discordNotifyService: DiscordNotifyService,
  ) {}

  /**
   * 현재 노출 기간 내에 있는 활성 공지 조회 (접속 시 모달용)
   */
  async getActive() {
    const now = new Date();
    const notices = await this.noticeRepository.find({
      where: {
        is_active: true,
        expose_start_at: LessThanOrEqual(now),
        expose_end_at: MoreThanOrEqual(now),
      },
      order: { published_at: 'DESC' },
    });

    return notices.map((notice) => ({
      id: notice.id,
      title: notice.title,
      content: notice.content,
      publishedAt: notice.published_at,
    }));
  }

  /**
   * 업데이트 내역 적재 (관리자, 내부용, 저장 시점엔 사용자에게 노출 안 됨)
   */
  async createEntry(type: string, content: string): Promise<UpdateEntry> {
    const entry = this.entryRepository.create({ type, content });
    return this.entryRepository.save(entry);
  }

  /**
   * 누적된 업데이트 내역 중 선택한 것들을 묶어 공지로 발행.
   * 노출 기간은 발행일로부터 7일 고정.
   *
   * 동시성: entryIds를 "notice_id가 비어있는 것만" 조건으로 원자적으로
   * UPDATE해서 잠근다. 관리자 두 명이 겹치는 entryIds로 동시에 발행을
   * 시도하면 먼저 커밋된 쪽만 성공하고, 나중 쪽은 409로 실패한다
   * (공지 자체도 같은 트랜잭션이라 함께 롤백됨).
   */
  async publish(
    title: string,
    content: string,
    entryIds: number[],
  ): Promise<{ id: number; publishedAt: Date; exposeEndAt: Date }> {
    const existingCount = await this.entryRepository.count({
      where: { id: In(entryIds) },
    });
    if (existingCount !== entryIds.length) {
      throw new BadRequestException(
        '존재하지 않는 update_entries ID가 포함되어 있습니다.',
      );
    }

    return this.dataSource
      .transaction(async (manager) => {
        const now = new Date();
        const exposeEndAt = new Date(now);
        exposeEndAt.setDate(exposeEndAt.getDate() + EXPOSE_DAYS);

        const notice = manager.create(UpdateNotice, {
          title,
          content,
          expose_start_at: now,
          expose_end_at: exposeEndAt,
          is_active: true,
        });
        await manager.save(notice);

        // notice_id가 비어있는 것만 원자적으로 잠가서 업데이트.
        // 이미 다른 공지에 묶인 게 있으면 매칭되는 행 수가 줄어든다.
        const result = await manager
          .createQueryBuilder()
          .update(UpdateEntry)
          .set({ notice_id: notice.id })
          .where('id IN (:...entryIds)', { entryIds })
          .andWhere('notice_id IS NULL')
          .execute();

        if (result.affected !== entryIds.length) {
          throw new ConflictException(
            '이미 다른 공지에 포함된 내역이 있습니다. 최신 상태를 다시 확인해주세요.',
          );
        }

        return {
          id: notice.id,
          publishedAt: notice.published_at,
          exposeEndAt: notice.expose_end_at,
        };
      })
      .then(async (published) => {
        await this.discordNotifyService.notify(
          `📢 업데이트 공지 발행: ${title}\n노출 기간: ~${published.exposeEndAt
            .toISOString()
            .slice(0, 10)}`,
        );
        return published;
      });
  }
}
