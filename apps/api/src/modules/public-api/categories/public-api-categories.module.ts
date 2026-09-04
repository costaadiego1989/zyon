import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { CatalogModule } from '../../catalog/catalog.module.js';
import { CategoriesV1Controller } from './presentation/http/categories-v1.controller.js';

@Module({
  imports: [IntegrationsModule, CatalogModule],
  controllers: [CategoriesV1Controller],
})
export class PublicApiCategoriesModule {}
