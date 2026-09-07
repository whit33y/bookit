import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module';
import { BusinessFavoriteController } from './business-favorite.controller';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

@Module({
  // po ReviewsService.statsFor: karta na liście ulubionych pokazuje ocenę tak samo jak karta
  // wyniku wyszukiwarki. Cyklu nie ma — ReviewsModule nie importuje niczego.
  imports: [ReviewsModule],
  controllers: [BusinessFavoriteController, FavoritesController],
  // Serwis zostaje wewnątrz modułu. Kasowanie przy zmianie roli, które potrzebują admin
  // i pracownicy, wychodzi osobno jako `clearFavorites` — funkcja na transakcji, nie provider.
  providers: [FavoritesService],
})
export class FavoritesModule {}
