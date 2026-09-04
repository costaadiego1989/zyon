import type { SupportFaqItem, SupportSettings, SupportSettingsPatch } from "@zyon/shared-types";

const MAX_FAQ_ITEMS = 20;
const MAX_QUESTION_LENGTH = 200;
const MAX_ANSWER_LENGTH = 1000;

export class SupportSettingsEntity {
  private constructor(private readonly props: SupportSettings) {}

  static createDefault(merchantId: string): SupportSettingsEntity {
    const now = new Date().toISOString();
    return new SupportSettingsEntity({ merchantId, faqItems: [], updatedAt: now });
  }

  static rehydrate(data: SupportSettings): SupportSettingsEntity {
    return new SupportSettingsEntity(data);
  }

  update(patch: SupportSettingsPatch): SupportSettingsEntity {
    validateFaqItems(patch.faqItems);
    return new SupportSettingsEntity({
      ...this.props,
      faqItems: patch.faqItems,
      updatedAt: new Date().toISOString(),
    });
  }

  snapshot(): SupportSettings {
    return { ...this.props, faqItems: [...this.props.faqItems] };
  }

  get faqItems(): SupportFaqItem[] {
    return this.props.faqItems;
  }

  get merchantId(): string {
    return this.props.merchantId;
  }
}

function validateFaqItems(items: SupportFaqItem[]): void {
  if (items.length > MAX_FAQ_ITEMS) {
    throw new Error("support_settings_invalid_faq_items");
  }
  for (const item of items) {
    if (!item.id || !item.question.trim() || !item.answer.trim()) {
      throw new Error("support_settings_invalid_faq_items");
    }
    if (item.question.length > MAX_QUESTION_LENGTH || item.answer.length > MAX_ANSWER_LENGTH) {
      throw new Error("support_settings_invalid_faq_items");
    }
  }
}
