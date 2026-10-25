import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export const PLATFORM_FEEDBACK_CATEGORIES = ["bug", "improvement", "suggestion", "other"] as const;

export type PlatformFeedbackCategory = (typeof PLATFORM_FEEDBACK_CATEGORIES)[number];

export class SubmitPlatformFeedbackDto {
  @IsIn(PLATFORM_FEEDBACK_CATEGORIES)
  category!: PlatformFeedbackCategory;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message!: string;
}
