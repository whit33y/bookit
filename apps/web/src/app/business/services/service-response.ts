import type { DepositType } from '../../shared/deposit';

/**
 * Lustro odpowiedzi `GET /businesses/mine/services` (serviceSelect + employees w findAll,
 * #16/#18/#21). Repo nie ma wspólnej libki DTO (patrz `core/api-client.ts`), więc kontrakt
 * jest po stronie web powielony ręcznie.
 *
 * Typy stoją osobno od `services.ts`, bo czyta je też kafelek pulpitu (#135) — jak
 * `stats-response.ts` przy #134: dwa czytniki tej samej odpowiedzi nie mogą mieć dwóch
 * opisów jej kształtu.
 */

export interface ServiceEmployee {
  id: string;
  name: string;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  isActive: boolean;
  /** Zaliczka (#50/#114) — oba pola null = usługa płatna w całości na miejscu. */
  depositType: DepositType | null;
  depositValue: number | null;
  employees: ServiceEmployee[];
}
