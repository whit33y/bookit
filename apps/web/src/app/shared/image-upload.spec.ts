import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import {
  MAX_IMAGE_MB,
  imageRejectionMessage,
  oversizeMessage,
  pickedFile,
} from './image-upload';

function file(size: number): File {
  const f = new File([new Uint8Array(1)], 'obraz.png', { type: 'image/png' });
  Object.defineProperty(f, 'size', { value: size, configurable: true });
  return f;
}

function rejection(status: number): HttpErrorResponse {
  return new HttpErrorResponse({ status, statusText: 'Rejected' });
}

/** `<input type="file">` z podłożoną listą plików — jsdom nie ma `DataTransfer`. */
function inputWith(files: File[]): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  return input;
}

describe('wgrywanie obrazów', () => {
  it('nie przepuszcza pliku ponad limit, mieszczący się zwraca bez komunikatu', () => {
    expect(oversizeMessage(file(1024))).toBeNull();
    expect(oversizeMessage(file(MAX_IMAGE_MB * 1024 * 1024 + 1))).toContain('za duży');
  });

  it('rozróżnia powody, dla których API odrzuciło plik', () => {
    expect(imageRejectionMessage(rejection(415))).toContain('format');
    expect(imageRejectionMessage(rejection(413))).toContain('za duży');
    expect(imageRejectionMessage(rejection(422))).toContain('odczytać');
  });

  // każdy inny błąd opisuje wywołujący — tylko on wie, czego nie udało się zapisać
  it('zwraca null dla błędu, który nie dotyczy samego pliku', () => {
    expect(imageRejectionMessage(rejection(500))).toBeNull();
    expect(imageRejectionMessage(new Error('offline'))).toBeNull();
  });

  it('oddaje wybrany plik i czyści input, żeby ten sam plik dało się wybrać ponownie', () => {
    const input = inputWith([file(1024)]);
    input.value = '';

    expect(pickedFile({ target: input } as unknown as Event)?.name).toBe('obraz.png');
    expect(input.value).toBe('');
  });

  it('zwraca null, gdy okno wyboru zamknięto bez pliku', () => {
    expect(pickedFile({ target: inputWith([]) } as unknown as Event)).toBeNull();
  });
});
