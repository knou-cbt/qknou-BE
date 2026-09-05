import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { UpdateNotice } from './entities/update-notice.entity';
import { UpdateEntry } from './entities/update-entry.entity';

/** 발행 시 노출 기간 (고정 7일) */
const EXPOSE_DAYS = 7;

@Injectable()
export class NoticesService {
  constructor(
    @InjectRepository(UpdateNotice)
    private noticeRepository: Repository<UpdateNotice>,
    @InjectRepository(UpdateEntry)
    private entryRepository: Repository<UpdateEntry>,
  ) {}

  /**
   * 현재 노출 기간 내에 있는 활성 공지 조회 (접속 시 모달용)
   */
  async getActive() {
    const now = new Date();
    return this.noticeRepository.find({
      where: {
        is_active: true,
        expose_start_at: LessThanOrEqual(now),
        expose_end_at: MoreThanOrEqual(now),
      },
      order: { published_at: 'DESC' },
    });
  }

  /**
   * 업데이트 내역 적재 (관리자, 내부용, 저장 시점엔 사용자에게 노출 안 됨)
   */
  async createEntry(type: string, content: string): Promise<UpdateEntry> {
    const entry = this.entryRepository.create({ type, content });
    return this.entryRepository.save(entry);
  }

  /**
   * 누적된 업데이트 내역 중 선택한 것들을 묶어 공지로 발행
   * 노출 기간은 발행일로부터 7일 고정
   */
  async publish(
    title: string,
    content: string,
    entryIds: number[],
  ): Promise<UpdateNotice> {
    const entries = await this.entryRepository.find({
      where: { id: In(entryIds) },
    });

    if (entries.length !== entryIds.length) {
      throw new BadRequestException(
        '존재하지 않는 update_entries ID가 포함되어 있습니다.',
      );
    }
    const alreadyBundled = entries.filter((e) => e.notice_id !== null);
    if (alreadyBundled.length > 0) {
      throw new BadRequestException(
        `이미 다른 공지에 포함된 내역입니다: ${alreadyBundled.map((e) => e.id).join(', ')}`,
      );
    }

    const now = new Date();
    const exposeEndAt = new Date(now);
    exposeEndAt.setDate(exposeEndAt.getDate() + EXPOSE_DAYS);

    const notice = this.noticeRepository.create({
      title,
      content,
      expose_start_at: now,
      expose_end_at: exposeEndAt,
      is_active: true,
    });
    await this.noticeRepository.save(notice);

    await this.entryRepository.update(
      { id: In(entryIds) },
      { notice_id: notice.id },
    );

    return notice;
  }
}
