import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WidgetBehaviorResponse {
  @ApiProperty({ enum: ['bottom-right', 'bottom-left', 'top-right', 'top-left'], example: 'bottom-right' })
  position!: string;

  @ApiProperty({ example: '#FF6B35' })
  fab_color!: string;

  @ApiProperty({ example: 'Talk to an agent' })
  invite_text!: string;

  @ApiProperty({ enum: ['drawer', 'modal', 'embedded'], example: 'drawer' })
  presentation_mode!: string;

  @ApiProperty({ example: false })
  start_minimized!: boolean;

  @ApiProperty({ example: 0, description: 'Delay in seconds before showing widget' })
  initial_delay_seconds!: number;

  @ApiProperty({ example: true })
  show_cart_badge!: boolean;

  @ApiProperty({ enum: ['open_widget', 'redirect'], example: 'open_widget' })
  fab_click_action!: string;

  @ApiPropertyOptional({ example: 'https://example.com' })
  fab_redirect_url?: string | null;

  @ApiProperty({ enum: ['auto', 'manual'], example: 'auto' })
  cart_presentation_mode!: string;

  @ApiProperty({ example: false })
  budget_mode_enabled!: boolean;

  @ApiProperty({ example: true })
  open_widget_on_trigger!: boolean;
}

export class TriggerRuleResponse {
  @ApiProperty({ example: 'high_value_cart' })
  trigger!: string;

  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({ example: 1.0, description: 'Weight (0-1)' })
  weight!: number;

  @ApiProperty({ example: { min_cart_value: 50000 }, description: 'Condition expression' })
  condition!: Record<string, any>;
}

export class SuppressionRulesResponse {
  @ApiProperty({ example: ['checkout_payment', 'checkout_review'], description: 'Steps where widget is hidden' })
  suppressed_steps!: string[];

  @ApiProperty({ example: ['AR', 'CL'], description: 'Regions where widget is suppressed' })
  blocked_regions!: string[];

  @ApiProperty({ example: 5000, description: 'Minimum cart value in cents to show widget' })
  minimum_cart_value!: number;
}

export class HandoffConfigResponse {
  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({ example: 'I can connect you with our support team' })
  message!: string;

  @ApiProperty({ example: ['email', 'whatsapp', 'phone'] })
  channels!: string[];
}

export class InterventionPolicyResponse {
  @ApiProperty({ example: 300, description: 'Cooldown in seconds between interventions' })
  cooldown_seconds!: number;

  @ApiProperty({ example: 3, description: 'Maximum interventions per session' })
  max_interventions_per_session!: number;
}

export class CheckoutSettingsResponse {
  @ApiProperty({ example: 'mch_xyz789' })
  merchant_id!: string;

  @ApiProperty({ enum: ['development', 'production'], example: 'production' })
  mode!: string;

  @ApiProperty({ type: WidgetBehaviorResponse })
  widget_behavior!: WidgetBehaviorResponse;

  @ApiProperty({ type: [TriggerRuleResponse] })
  trigger_rules!: TriggerRuleResponse[];

  @ApiProperty({ type: SuppressionRulesResponse })
  suppression_rules!: SuppressionRulesResponse;

  @ApiProperty({ type: HandoffConfigResponse })
  handoff!: HandoffConfigResponse;

  @ApiProperty({ type: InterventionPolicyResponse })
  intervention_policy!: InterventionPolicyResponse;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  updated_at!: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  created_at!: string;
}

export class CompanyAddressResponse {
  @ApiPropertyOptional({ example: 'Av. Paulista' })
  street!: string | null;

  @ApiPropertyOptional({ example: '1000' })
  number!: string | null;

  @ApiPropertyOptional({ example: 'Apt 42' })
  complement!: string | null;

  @ApiPropertyOptional({ example: 'Bela Vista' })
  neighborhood!: string | null;

  @ApiPropertyOptional({ example: 'São Paulo' })
  city!: string | null;

  @ApiPropertyOptional({ example: 'SP' })
  state!: string | null;

  @ApiPropertyOptional({ example: '01311-100' })
  zip!: string | null;
}

export class CompanyResponse {
  @ApiPropertyOptional({ example: '12.345.678/0001-90' })
  cnpj!: string | null;

  @ApiPropertyOptional({ example: 'Example Company Ltd' })
  razao_social!: string | null;

  @ApiPropertyOptional({ example: '123.456.789.012' })
  inscricao_estadual!: string | null;

  @ApiPropertyOptional({ example: 'contact@example.com' })
  email!: string | null;

  @ApiPropertyOptional({ example: '+55 11 1234-5678' })
  phone!: string | null;

  @ApiProperty({ type: CompanyAddressResponse })
  address!: CompanyAddressResponse | null;
}

export class SocialResponse {
  @ApiPropertyOptional({ example: '@example' })
  instagram!: string | null;

  @ApiPropertyOptional({ example: 'example' })
  facebook!: string | null;

  @ApiPropertyOptional({ example: 'example' })
  linkedin!: string | null;

  @ApiPropertyOptional({ example: 'example' })
  youtube!: string | null;

  @ApiPropertyOptional({ example: 'https://maps.google.com/?cid=1234' })
  google_maps!: string | null;
}

export class PoliciesResponse {
  @ApiPropertyOptional({ example: 'https://example.com/privacy' })
  privacy!: string | null;

  @ApiPropertyOptional({ example: 'https://example.com/returns' })
  returns!: string | null;

  @ApiPropertyOptional({ example: 'https://example.com/terms' })
  terms!: string | null;

  @ApiPropertyOptional({ example: 'https://example.com/shipping' })
  shipping!: string | null;
}

export class StylesResponse {
  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.png' })
  logo_url!: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/favicon.ico' })
  favicon_url!: string | null;

  @ApiPropertyOptional({ example: '#FF6B35' })
  accent_color!: string | null;

  @ApiPropertyOptional({ example: '#00A8E1' })
  secondary_color!: string | null;

  @ApiPropertyOptional({ example: 'system' })
  font_display!: string | null;

  @ApiPropertyOptional({ example: 'Inter' })
  font_family!: string | null;
}

export class BusinessHoursResponse {
  @ApiProperty({ example: 'monday' })
  day!: string;

  @ApiProperty({ example: '09:00' })
  open!: string;

  @ApiProperty({ example: '18:00' })
  close!: string;
}

export class StoreSettingsResponse {
  @ApiProperty({ type: CompanyResponse })
  company!: CompanyResponse | null;

  @ApiProperty({ type: SocialResponse })
  social!: SocialResponse | null;

  @ApiProperty({ type: PoliciesResponse })
  policies!: PoliciesResponse | null;

  @ApiProperty({ type: StylesResponse })
  styles!: StylesResponse | null;

  @ApiProperty({ type: [BusinessHoursResponse], description: 'Business hours per day' })
  business_hours!: BusinessHoursResponse[];

  @ApiPropertyOptional({ example: 'example-store' })
  slug!: string | null;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  updated_at!: string | null;
}

export class SeoDataResponse {
  @ApiPropertyOptional({ example: 'Example Store - Best Products' })
  title!: string | null;

  @ApiPropertyOptional({ example: 'Shop quality products at Example Store' })
  description!: string | null;

  @ApiPropertyOptional({ example: 'Example Store - Premium Products' })
  og_title!: string | null;

  @ApiPropertyOptional({ example: 'Discover our exclusive collection' })
  og_description!: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/og-image.jpg' })
  og_image!: string | null;

  @ApiProperty({ example: ['ecommerce', 'products', 'shopping'] })
  keywords!: string[];

  @ApiPropertyOptional({ example: 'summary_large_image' })
  twitter_card!: string | null;

  @ApiPropertyOptional({ example: 'index, follow' })
  robots!: string | null;

  @ApiPropertyOptional({ example: 'https://example.com/products' })
  canonical!: string | null;
}

export class PixelIdsResponse {
  @ApiPropertyOptional({ example: '123456789' })
  facebook!: string | null;

  @ApiPropertyOptional({ example: '654321987' })
  tiktok!: string | null;

  @ApiPropertyOptional({ example: '987654321' })
  snapchat!: string | null;

  @ApiPropertyOptional({ example: '111222333' })
  pinterest!: string | null;
}

export class GtmDataResponse {
  @ApiPropertyOptional({ example: 'GTM-ABC1234' })
  gtm_id!: string | null;

  @ApiPropertyOptional({ example: 'GA-123456-1' })
  ga_tracking_id!: string | null;

  @ApiProperty({ type: PixelIdsResponse })
  pixel_ids!: PixelIdsResponse | null;
}

export class SeoSettingsResponse {
  @ApiProperty({ type: SeoDataResponse })
  seo!: SeoDataResponse;

  @ApiProperty({ type: GtmDataResponse })
  gtm!: GtmDataResponse;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  updated_at!: string | null;
}

export class GuardrailsResponse {
  @ApiProperty({ example: true })
  forbid_unauthorized_discounts!: boolean;

  @ApiProperty({ example: true })
  forbid_unauthorized_free_shipping!: boolean;

  @ApiProperty({ example: false })
  forbid_payment_method_changes!: boolean;
}

export class DiscountPolicyResponse {
  @ApiProperty({ example: 30, description: 'Max discount % per order' })
  max_discount_percent!: number;

  @ApiProperty({ example: 20, description: 'Min margin % to maintain after discount' })
  minimum_margin_percent!: number;
}

export class ShippingPolicyResponse {
  @ApiProperty({ example: 50, description: 'Max shipping subsidy % per order' })
  max_subsidy_percent!: number;

  @ApiProperty({ example: 5000, description: 'Max shipping subsidy in cents per order' })
  max_subsidy_absolute!: number;
}

export class AgentRulesResponse {
  @ApiProperty({ example: 'mch_xyz789' })
  merchant_id!: string;

  @ApiProperty({ example: 'agent_abc123' })
  agent_id!: string;

  @ApiProperty({ example: 'user_xyz789' })
  user_id!: string;

  @ApiProperty({ type: GuardrailsResponse })
  guardrails!: GuardrailsResponse;

  @ApiProperty({ type: DiscountPolicyResponse })
  discount_policy!: DiscountPolicyResponse;

  @ApiProperty({ type: ShippingPolicyResponse })
  shipping_policy!: ShippingPolicyResponse;

  @ApiProperty({
    example: [
      'No claims about product quality without evidence',
      'Never promise stock guarantees',
    ],
    description: 'Copy constraints (guardrails) for LLM',
  })
  copy_constraints!: string[];

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  updated_at!: string;
}
