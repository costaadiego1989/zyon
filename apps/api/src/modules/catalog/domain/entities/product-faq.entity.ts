/**
 * ProductFaqEntity
 *
 * One per-product frequently-asked question. Pure domain entity — no
 * Prisma or NestJS dependency. Tenant scoping lives at the repository
 * port signature, not on the entity itself.
 *
 * Invariants enforced at rehydrate:
 *   - `question` is non-empty after trim.
 *   - `answer` is non-empty after trim.
 *
 * Immutable: all transformation methods return a new instance.
 */

export interface ProductFaqProps {
  id: string;
  productId: string;
  question: string;
  answer: string;
  order: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class ProductFaqEntity {
  readonly id: string;
  readonly productId: string;
  readonly question: string;
  readonly answer: string;
  readonly order: number;
  readonly isPublished: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: ProductFaqProps) {
    this.id = props.id;
    this.productId = props.productId;
    this.question = props.question;
    this.answer = props.answer;
    this.order = props.order;
    this.isPublished = props.isPublished;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static rehydrate(props: ProductFaqProps): ProductFaqEntity {
    if (!props.id || props.id.length === 0) {
      throw new Error("product_faq_id_required");
    }
    if (!props.productId || props.productId.length === 0) {
      throw new Error("product_faq_product_id_required");
    }
    if (typeof props.question !== "string" || props.question.trim().length === 0) {
      throw new Error("product_faq_question_empty");
    }
    if (typeof props.answer !== "string" || props.answer.trim().length === 0) {
      throw new Error("product_faq_answer_empty");
    }
    return new ProductFaqEntity({
      ...props,
      question: props.question,
      answer: props.answer,
    });
  }

  publish(): ProductFaqEntity {
    if (this.isPublished) return this;
    return new ProductFaqEntity({ ...this.snapshot(), isPublished: true, updatedAt: new Date() });
  }

  unpublish(): ProductFaqEntity {
    if (!this.isPublished) return this;
    return new ProductFaqEntity({ ...this.snapshot(), isPublished: false, updatedAt: new Date() });
  }

  /** Update mutable copy fields — both are required and must be non-empty. */
  edit(input: { question?: string; answer?: string; order?: number }): ProductFaqEntity {
    const nextQuestion =
      input.question !== undefined ? input.question : this.question;
    const nextAnswer =
      input.answer !== undefined ? input.answer : this.answer;
    const nextOrder = input.order !== undefined ? input.order : this.order;

    if (nextQuestion.trim().length === 0) {
      throw new Error("product_faq_question_empty");
    }
    if (nextAnswer.trim().length === 0) {
      throw new Error("product_faq_answer_empty");
    }

    return new ProductFaqEntity({
      ...this.snapshot(),
      question: nextQuestion,
      answer: nextAnswer,
      order: nextOrder,
      updatedAt: new Date(),
    });
  }

  private snapshot(): ProductFaqProps {
    return {
      id: this.id,
      productId: this.productId,
      question: this.question,
      answer: this.answer,
      order: this.order,
      isPublished: this.isPublished,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
