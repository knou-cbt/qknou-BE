import { Questsion } from "src/questions/entities/question.entity";
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

@Entity('choices')
export class Choice{
  
  @PrimaryGeneratedColumn()
  id: number;

  @Column({type:'int', nullable: false})
  question_id: number; 

  @Column({type:'int', nullable: false})
  choice_number: number;

  @Column({type:'text', nullable: false})
  choice_text: string;

  @Column({type:'text', nullable: true})
  choice_image_url: string

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => Questsion)
  @JoinColumn({ name: 'question_id' })
  question: Questsion;
}