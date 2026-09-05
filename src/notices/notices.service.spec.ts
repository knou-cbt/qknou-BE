import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { NoticesService } from './notices.service';
import { UpdateNotice } from './entities/update-notice.entity';
import { UpdateEntry } from './entities/update-entry.entity';
import { DiscordNotifyService } from 'src/notifications/discord-notify.service';

describe('NoticesService', () => {
  let service: NoticesService;
  let noticeRepository: { find: jest.Mock };
  let entryRepository: { count: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let discordNotifyService: { notify: jest.Mock };

  beforeEach(async () => {
    noticeRepository = { find: jest.fn() };
    entryRepository = { count: jest.fn() };
    dataSource = { transaction: jest.fn() };
    discordNotifyService = { notify: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoticesService,
        {
          provide: getRepositoryToken(UpdateNotice),
          useValue: noticeRepository,
        },
        { provide: getRepositoryToken(UpdateEntry), useValue: entryRepository },
        { provide: DataSource, useValue: dataSource },
        { provide: DiscordNotifyService, useValue: discordNotifyService },
      ],
    }).compile();

    service = module.get(NoticesService);
  });

  describe('getActive', () => {
    it('활성 공지를 camelCase 필드로 매핑해서 반환한다', async () => {
      const publishedAt = new Date('2026-01-01T00:00:00Z');
      noticeRepository.find.mockResolvedValue([
        {
          id: 1,
          title: 't',
          content: 'c',
          published_at: publishedAt,
          expose_start_at: publishedAt,
          expose_end_at: publishedAt,
          is_active: true,
        },
      ]);

      const result = await service.getActive();

      expect(result).toEqual([
        { id: 1, title: 't', content: 'c', publishedAt },
      ]);
      // 내부 필드(is_active 등)가 새어나가지 않는지 확인
      expect(result[0]).not.toHaveProperty('is_active');
      expect(result[0]).not.toHaveProperty('expose_end_at');
    });
  });

  describe('publish', () => {
    it('존재하지 않는 entryId가 섞여 있으면 BadRequestException', async () => {
      entryRepository.count.mockResolvedValue(1); // entryIds.length=2인데 1개만 존재

      await expect(service.publish('title', 'content', [1, 2])).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('정상 발행 시 결과를 반환하고 Discord로 알린다', async () => {
      entryRepository.count.mockResolvedValue(2);

      const savedNotice = {
        id: 10,
        published_at: new Date(),
        expose_end_at: new Date(),
      };
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      };
      const mockManager = {
        create: jest.fn().mockReturnValue(savedNotice),
        save: jest.fn().mockResolvedValue(undefined),
        createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      };
      dataSource.transaction.mockImplementation((cb: any) => cb(mockManager));

      const result = await service.publish('title', 'content', [1, 2]);

      expect(result.id).toBe(10);
      expect(mockQb.andWhere).toHaveBeenCalledWith('notice_id IS NULL');
      expect(discordNotifyService.notify).toHaveBeenCalledTimes(1);
    });

    it('동시 발행으로 entryIds 일부가 이미 다른 공지에 묶였으면 ConflictException, Discord 알림도 안 보낸다', async () => {
      entryRepository.count.mockResolvedValue(2);

      const savedNotice = {
        id: 10,
        published_at: new Date(),
        expose_end_at: new Date(),
      };
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        // 2개 중 1개만 매칭됐다는 뜻 (다른 공지가 나머지 하나를 먼저 채감)
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      const mockManager = {
        create: jest.fn().mockReturnValue(savedNotice),
        save: jest.fn().mockResolvedValue(undefined),
        createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      };
      dataSource.transaction.mockImplementation((cb: any) => cb(mockManager));

      await expect(service.publish('title', 'content', [1, 2])).rejects.toThrow(
        ConflictException,
      );
      expect(discordNotifyService.notify).not.toHaveBeenCalled();
    });
  });
});
