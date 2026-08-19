import { Module } from '@nestjs/common';
import { CatalogModule } from '../../catalog/catalog.module.js';
import { CategoriesV1Controller } from './presentation/http/categories-v1.controller.js';

@Module({
  imports: [CatalogModule],
  controllers: [CategoriesV1Controller],
})
export class PublicApiCategoriesModule {}
