import { Exam } from 'src/exams/entities/exam.entity';
import { ExamType } from 'src/exams/enums/exam-type.enum';
import { Subject } from 'src/subjects/entities/subject.entity';
import { User } from 'src/users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ExamSubmissionStatus =
  | 'pending' // 접수됨, OCR 대기
  | 'processing' // OCR 처리 중 (워커가 직접 갱신)
  | 'parsed' // OCR 완료, 관리자 검수 대기
  | 'failed' // OCR 실패
  | 'published' // 관리자가 게시 (exams/questions에 반영됨)
  | 'rejected'; // 관리자가 반려

/** 업로드 시점부터 검수/게시까지 이어지는 시험지 등록 요청 1건 */
@Entity('exam_submissions')
@Index('IDX_exam_submissions_status', ['status'])
@Index('IDX_exam_submissions_user_id', ['user_id'])
export class ExamSubmission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'int', nullable: false })
  subject_id: number;

  @Column({ type: 'int', nullable: false })
  year: number;

  @Column({ type: 'smallint', nullable: false })
  exam_type: ExamType;

  @Column({ type: 'text', nullable: false })
  file_url: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ExamSubmissionStatus;

  /**
   * OCR 결과(문항 배열). 크롤러 파이프라인과 동일한 중간 표현을 씀
   * (questionNumber, questionText, choices, correctAnswers 등 camelCase).
   * 관리자가 게시 전까지 여기서 직접 수정 가능.
   */
  @Column({ type: 'jsonb', nullable: true })
  parsed_result: {
    examTitle: string;
    questions: Array<{
      questionNumber: number;
      questionText: string;
      exampleText?: string | null;
      sharedExample?: string | null;
      sharedExampleImageUrls?: string[] | null;
      questionImageUrls?: string[] | null;
      correctAnswers: number[];
      choices: Array<{
        number: number;
        text: string;
        imageUrls: string[] | null;
      }>;
      explanation?: string | null;
    }>;
  } | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'text', nullable: true })
  reject_reason: string | null;

  /** 게시 완료 시 생성된 실제 exams.id (재호출 시 멱등 응답용) */
  @Column({ type: 'int', nullable: true })
  published_exam_id: number | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at: Date | null;

  /** PATCH 낙관적 락용. 매 수정마다 증가 */
  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Subject, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @ManyToOne(() => Exam, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'published_exam_id' })
  publishedExam: Exam | null;
}
