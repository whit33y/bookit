import { DepositType, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

const dto: CreateServiceDto = {
  name: 'Strzyżenie',
  durationMin: 30,
  priceCents: 5000,
};

// stan usługi z bazy, po który update sięga przy dotknięciu ceny lub zaliczki
const currentService = (overrides: Record<string, unknown> = {}) => ({
  depositType: null,
  depositValue: null,
  priceCents: 5000,
  ...overrides,
});

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('błąd', {
    code,
    clientVersion: 'test',
  });

describe('ServicesService', () => {
  let businessFindUnique: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;
  let findFirst: ReturnType<typeof vi.fn>;
  let findUnique: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let updateMany: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let employeeCount: ReturnType<typeof vi.fn>;
  let service: ServicesService;

  beforeEach(() => {
    businessFindUnique = vi.fn().mockResolvedValue({ id: 'b1' });
    findMany = vi.fn();
    findFirst = vi.fn();
    findUnique = vi.fn();
    create = vi.fn();
    updateMany = vi.fn();
    update = vi.fn();
    remove = vi.fn();
    employeeCount = vi.fn();
    const prisma = {
      business: { findUnique: businessFindUnique },
      service: { findMany, findFirst, findUnique, create, updateMany, update, delete: remove },
      employee: { count: employeeCount },
    };
    service = new ServicesService(prisma as unknown as PrismaService);
  });

  it('findAll zwraca wszystkie usługi firmy (także nieaktywne) z pracownikami, scope po businessId', async () => {
    findMany.mockResolvedValue([{ id: 's1', employees: [{ id: 'e1', name: 'Ala' }] }]);

    const result = await service.findAll('user-1');

    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ businessId: 'b1' });
    // brak filtra isActive — widok właściciela pokazuje też dezaktywowane
    expect(arg.where.isActive).toBeUndefined();
    // select niesie przypisanych pracowników (panel #21 wypełnia multi-select)
    expect(arg.select.employees).toBeDefined();
    expect(result).toEqual([{ id: 's1', employees: [{ id: 'e1', name: 'Ala' }] }]);
  });

  it('create dokłada businessId z tokena, nie z body', async () => {
    create.mockResolvedValue({ id: 's1' });

    await service.create('user-1', dto);

    expect(create.mock.calls[0][0].data).toEqual({ ...dto, businessId: 'b1' });
  });

  it('OWNER bez firmy → 404', async () => {
    businessFindUnique.mockResolvedValue(null);

    await expect(service.findAll('user-1')).rejects.toMatchObject({ status: 404 });
  });

  it('update scope po businessId; brak trafienia (cudza usługa) → 404', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(service.update('user-1', 's1', { name: 'Nowa' })).rejects.toMatchObject({
      status: 404,
    });
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 's1', businessId: 'b1' });
  });

  it('update zwraca odświeżoną usługę po udanej edycji', async () => {
    findFirst.mockResolvedValue(currentService());
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({ id: 's1', priceCents: 999 });

    const result = await service.update('user-1', 's1', { priceCents: 999 });

    expect(result).toEqual({ id: 's1', priceCents: 999 });
  });

  it('remove z rezerwacjami → dezaktywacja (isActive:false), bez delete', async () => {
    findFirst.mockResolvedValue({ id: 's1', _count: { bookings: 3 } });
    update.mockResolvedValue({ id: 's1', isActive: false });

    const result = await service.remove('user-1', 's1');

    expect(update.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(remove).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 's1', isActive: false, deactivated: true });
  });

  it('remove bez rezerwacji → twarde usunięcie', async () => {
    findFirst.mockResolvedValue({ id: 's1', _count: { bookings: 0 } });
    remove.mockResolvedValue({ id: 's1' });

    const result = await service.remove('user-1', 's1');

    expect(remove).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 's1', deactivated: false });
  });

  it('wyścig: rezerwacja po zliczeniu → delete rzuca P2003 → dezaktywacja zamiast 500', async () => {
    findFirst.mockResolvedValue({ id: 's1', _count: { bookings: 0 } });
    remove.mockRejectedValue(prismaError('P2003'));
    update.mockResolvedValue({ id: 's1', isActive: false });

    const result = await service.remove('user-1', 's1');

    expect(update.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(result).toEqual({ id: 's1', isActive: false, deactivated: true });
  });

  it('remove cudzej/nieistniejącej usługi → 404', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.remove('user-1', 's1')).rejects.toMatchObject({ status: 404 });
  });

  it('setEmployees ustawia pracowników (replace) scope po businessId', async () => {
    findFirst.mockResolvedValue({ id: 's1' });
    employeeCount.mockResolvedValue(2);
    update.mockResolvedValue({ id: 's1', employees: [{ id: 'e1' }, { id: 'e2' }] });

    const result = await service.setEmployees('user-1', 's1', ['e1', 'e2']);

    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 's1', businessId: 'b1' });
    expect(employeeCount.mock.calls[0][0].where).toEqual({
      id: { in: ['e1', 'e2'] },
      businessId: 'b1',
    });
    expect(update.mock.calls[0][0].data).toEqual({
      employees: { set: [{ id: 'e1' }, { id: 'e2' }] },
    });
    expect(result).toEqual({ id: 's1', employees: [{ id: 'e1' }, { id: 'e2' }] });
  });

  it('setEmployees z pracownikiem spoza firmy/nieistniejącym → 400', async () => {
    findFirst.mockResolvedValue({ id: 's1' });
    // dwa id, ale tylko jeden należy do firmy
    employeeCount.mockResolvedValue(1);

    await expect(
      service.setEmployees('user-1', 's1', ['e1', 'obcy']),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('setEmployees na cudzej/nieistniejącej usłudze → 404', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.setEmployees('user-1', 's1', ['e1']),
    ).rejects.toMatchObject({ status: 404 });
    expect(employeeCount).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('setEmployees: wyścig — set rzuca P2025 (pracownik usunięty) → 400 zamiast 500', async () => {
    findFirst.mockResolvedValue({ id: 's1' });
    employeeCount.mockResolvedValue(1);
    update.mockRejectedValue(prismaError('P2025'));

    await expect(
      service.setEmployees('user-1', 's1', ['e1']),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('setEmployees z pustą listą czyści przypisania bez sprawdzania pracowników', async () => {
    findFirst.mockResolvedValue({ id: 's1' });
    update.mockResolvedValue({ id: 's1', employees: [] });

    await service.setEmployees('user-1', 's1', []);

    expect(employeeCount).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data).toEqual({ employees: { set: [] } });
  });

  // zakres reguł zaliczki pokrywa deposit.spec.ts — tu sprawdzamy tylko, że serwis je woła
  // na właściwych danych (stan z bazy scalony z body) i mapuje na 400 zamiast 500 z CHECK-a
  describe('zaliczka (#50)', () => {
    it('select niesie pola zaliczki — wizard (#53) czyta je razem z ceną', async () => {
      findMany.mockResolvedValue([]);

      await service.findAll('user-1');

      const { select } = findMany.mock.calls[0][0];
      expect(select.depositType).toBe(true);
      expect(select.depositValue).toBe(true);
    });

    it('create z poprawną zaliczką przepuszcza oba pola do bazy', async () => {
      create.mockResolvedValue({ id: 's1' });

      await service.create('user-1', {
        ...dto,
        depositType: DepositType.PERCENT,
        depositValue: 30,
      });

      expect(create.mock.calls[0][0].data).toMatchObject({
        depositType: DepositType.PERCENT,
        depositValue: 30,
      });
    });

    it('create z zaliczką procentową poza zakresem → 400, bez zapisu', async () => {
      await expect(
        service.create('user-1', {
          ...dto,
          depositType: DepositType.PERCENT,
          depositValue: 101,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(create).not.toHaveBeenCalled();
    });

    it('create z zaliczką kwotową wyższą niż cena → 400', async () => {
      await expect(
        service.create('user-1', {
          ...dto,
          depositType: DepositType.FIXED,
          depositValue: dto.priceCents + 1,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(create).not.toHaveBeenCalled();
    });

    it('create z typem zaliczki bez wartości → 400', async () => {
      await expect(
        service.create('user-1', { ...dto, depositType: DepositType.FIXED }),
      ).rejects.toMatchObject({ status: 400 });
      expect(create).not.toHaveBeenCalled();
    });

    // sedno reguły krzyżowej: body nie tyka zaliczki, a mimo to unieważnia ją ceną
    it('update samej ceny pod kwotę zaliczki FIXED z bazy → 400', async () => {
      findFirst.mockResolvedValue(
        currentService({ depositType: DepositType.FIXED, depositValue: 3000 }),
      );

      await expect(
        service.update('user-1', 's1', { priceCents: 2000 }),
      ).rejects.toMatchObject({ status: 400 });
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('update samej ceny w górę zostawia zaliczkę FIXED w spokoju', async () => {
      findFirst.mockResolvedValue(
        currentService({ depositType: DepositType.FIXED, depositValue: 3000 }),
      );
      updateMany.mockResolvedValue({ count: 1 });
      findUnique.mockResolvedValue({ id: 's1' });

      await service.update('user-1', 's1', { priceCents: 9000 });

      expect(updateMany.mock.calls[0][0].data).toEqual({ priceCents: 9000 });
    });

    it('update z jawnym null w obu polach czyści zaliczkę', async () => {
      findFirst.mockResolvedValue(
        currentService({ depositType: DepositType.PERCENT, depositValue: 30 }),
      );
      updateMany.mockResolvedValue({ count: 1 });
      findUnique.mockResolvedValue({ id: 's1' });

      await service.update('user-1', 's1', {
        depositType: null,
        depositValue: null,
      });

      expect(updateMany.mock.calls[0][0].data).toEqual({
        depositType: null,
        depositValue: null,
      });
    });

    it('update zerujący samą wartość, z typem zostawionym w bazie → 400', async () => {
      findFirst.mockResolvedValue(
        currentService({ depositType: DepositType.PERCENT, depositValue: 30 }),
      );

      await expect(
        service.update('user-1', 's1', { depositValue: null }),
      ).rejects.toMatchObject({ status: 400 });
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('update samego typu na istniejącej wartości waliduje parę po scaleniu', async () => {
      // 3000 gr było poprawną kwotą, jako procent jest już poza zakresem 1–100
      findFirst.mockResolvedValue(
        currentService({ depositType: DepositType.FIXED, depositValue: 3000 }),
      );

      await expect(
        service.update('user-1', 's1', { depositType: DepositType.PERCENT }),
      ).rejects.toMatchObject({ status: 400 });
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('update nietykający ceny ani zaliczki nie dobiera stanu z bazy (bez dodatkowego zapytania)', async () => {
      updateMany.mockResolvedValue({ count: 1 });
      findUnique.mockResolvedValue({ id: 's1' });

      await service.update('user-1', 's1', { name: 'Nowa nazwa' });

      expect(findFirst).not.toHaveBeenCalled();
    });

    // Pozostałe testy podają literały obiektów, w których `in` rozróżnia klucze niezależnie
    // od konfiguracji TS. Tu budujemy DTO tak, jak robi to ValidationPipe, bo scalanie stanu
    // stoi na tym, że pole nieprzesłane NIE jest własnością instancji — a to zależy od
    // `useDefineForClassFields`, wyłączonego tylko dzięki `target: es2021`. Po podniesieniu
    // targetu na ES2022+ każde pole DTO byłoby własnością o wartości undefined, `in` przestałby
    // cokolwiek rozróżniać i walidacja zaliczki przy zmianie ceny cicho by przestała działać.
    describe('na instancji DTO, nie na litarale obiektu', () => {
      it('pole nieprzesłane nie jest własnością instancji (fundament scalania stanu)', () => {
        const dto = plainToInstance(UpdateServiceDto, { priceCents: 2000 });

        expect(Object.keys(dto)).toEqual(['priceCents']);
        expect('depositType' in dto).toBe(false);
      });

      it('jawny null jest własnością instancji — czyszczenie zaliczki da się odróżnić', () => {
        const dto = plainToInstance(UpdateServiceDto, {
          depositType: null,
          depositValue: null,
        });

        expect('depositType' in dto).toBe(true);
        expect(dto.depositType).toBeNull();
      });

      it('PATCH samej ceny pod kwotę zaliczki FIXED → 400 (a nie 500 z CHECK-a w bazie)', async () => {
        findFirst.mockResolvedValue(
          currentService({ depositType: DepositType.FIXED, depositValue: 3000 }),
        );

        await expect(
          service.update(
            'user-1',
            's1',
            plainToInstance(UpdateServiceDto, { priceCents: 2000 }),
          ),
        ).rejects.toMatchObject({ status: 400 });
        expect(updateMany).not.toHaveBeenCalled();
      });

      it('PATCH z oboma null czyści zaliczkę, mimo że reszta pól jest nieprzesłana', async () => {
        findFirst.mockResolvedValue(
          currentService({ depositType: DepositType.PERCENT, depositValue: 30 }),
        );
        updateMany.mockResolvedValue({ count: 1 });
        findUnique.mockResolvedValue({ id: 's1' });

        await service.update(
          'user-1',
          's1',
          plainToInstance(UpdateServiceDto, {
            depositType: null,
            depositValue: null,
          }),
        );

        expect(updateMany.mock.calls[0][0].data).toEqual({
          depositType: null,
          depositValue: null,
        });
      });
    });

    it('update zaliczki na cudzej/nieistniejącej usłudze → 404, bez zapisu', async () => {
      findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 's1', {
          depositType: DepositType.PERCENT,
          depositValue: 30,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(findFirst.mock.calls[0][0].where).toEqual({
        id: 's1',
        businessId: 'b1',
      });
      expect(updateMany).not.toHaveBeenCalled();
    });
  });
});
