import { Controller, Get } from '@nestjs/common';
import { CategoriesService } from './categories.service';

// publiczny słownik — bez guardów
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }
}
