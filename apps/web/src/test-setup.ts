import '@angular/compiler';
import '@analogjs/vitest-angular/setup-snapshots';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { beforeEach } from 'vitest';
import { resetLocale } from './app/core/i18n/locale';

setupTestBed();

// Sygnał języka żyje na poziomie modułu (core/i18n/locale.ts), więc jeden spek ustawiający EN
// zatruwałby kolejne pliki w tym samym workerze vitest. Reset globalny, nie w pojedynczych
// spekach — inaczej wystarczy zapomnieć raz, żeby dostać test zależny od kolejności.
beforeEach(() => resetLocale());
