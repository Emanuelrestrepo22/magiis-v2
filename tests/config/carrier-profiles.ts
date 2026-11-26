// tests/config/carrier-profiles.ts
// Perfil de carrier del circuito administrativo (S1..S6, edicion post-cierre, liquidaciones, reportes).
// Seleccion por CIRCUIT_CARRIER (default `1901`). Aqui viven los hechos de mercado y los fixtures
// conocidos; las CREDENCIALES y los ids de fixture que hoy vienen del entorno (<PREFIX>_DRIVER_ID, ...)
// siguen en el archivo .env que el perfil nombra. Sin dependencias de runtime.ts (lo importa runtime.ts).
//
// Fail-fast: un campo pendiente de descubrir se marca con TODO. `loadCarrierProfile(id)` lanza listando
// TODOS los campos pendientes; NUNCA cae en valores de otro carrier.

import {
  fixedPerDay,
  splitFromSettings,
  type CommissionSettings
} from '../helpers/commission-settings.js';

export const DEFAULT_CIRCUIT_CARRIER = '1901';

/** Marcador de valor pendiente de descubrir (solo vive en el borrador; nunca llega a un spec). */
export const TODO = { __todo: true } as const;
export type Todo = typeof TODO;

export type ThousandsSeparator = 'SPACE' | 'NONE' | 'COMMA' | 'DOT';

export type CommissionSplit = { owner: number; driver: number; agency: number };

/**
 * Origen del reparto de comision: `fixed` = constante del perfil (1901: 40/40/20); `db` = se lee de
 * COMMISSIONSETTINGS + DRIVERSETTLPARAM con `readCommissionSettings` y se registra con
 * `registerCommissionSettings` antes de usar el reparto.
 */
export type CommissionSource = { kind: 'fixed'; split: CommissionSplit } | { kind: 'db' };

export type CityTax = { present: true; conceptName: string; percent: number } | { present: false };

/** Ambiente al que pertenece el perfil: un perfil `uat` nunca opera con ENV=test y viceversa. */
export type ProfileEnv = 'test' | 'uat';

/** Concepto de «Otros costos» del catalogo del carrier, por nombre exacto (como lo lista el modal). */
export type PrepCost = {
  /** CARRIER_OTHER_COSTS.ID (documental; el modal elige por nombre). */
  id: number;
  name: string;
  /** Importe fijo precargado (FIX). Excluyente con `percent`. */
  fixed?: number;
  /** Porcentaje sobre la tarifa base (PCT). */
  percent?: number;
  commissionable: boolean;
  /** `IS_BY_COST=1`: solo se ofrece en viajes con tarifa por costo (cuenta corriente de contractor). */
  byCost?: boolean;
};

export type PrepCostSlot = 'cashNc' | 'cashCom' | 'accountNc' | 'accountCom';

/**
 * Como se elige el cliente/pasajero del alta y la ruta. `shortcut` = boton de pasajero frecuente (AR «Seba»);
 * `query` = typeahead de Customer (>= 3 caracteres, `optionText` = texto de la opcion si difiere);
 * `authorizer` = typeahead del Authorizer (contractor). `origin: null` = se conserva el autocompletado del cliente.
 */
export type PrepCustomer = {
  shortcut?: string;
  query?: string;
  optionText?: string;
  authorizer?: string;
  origin: string | null;
  destination: string;
};

/** Par chofer/vehiculo/propietario PROPIO de QA: el cierre administrativo se hace siempre con su `driverId`. */
export type PrepPair = {
  /** DRIVER.ID (finalizeAdmin y query `driverUserId` de la rendicion). */
  driverId: number;
  /** Etiqueta EXACTA del select de «Administrative finalization» («Apellido, Nombre»); null = no descubierta. */
  driverLabel: string | null;
  vehicleId: number;
  ownerId: number;
  /** Reparto de comision de ESTE par (por par, no por carrier). */
  commission: CommissionSource;
  /** Solo se opera sobre pares marcados `qaOwned` (datos propios, nunca de terceros). */
  qaOwned: true;
};

/**
 * Ficha de propietario del circuito (rendicion automatica, fase 2 W3). Hechos de la lectura de solo lectura del
 * 11/11 (GET carriers/{c}/vehicleOwners/{id}); `collectsCash` es el estado OBSERVADO en ese momento, no el
 * deseado: el armado lo cambia solo en las fases `arm`/`disarm` de la automatica.
 */
export type PrepOwner = {
  ownerId: number;
  /** `titularDescription` de la ficha. */
  ownerLabel: string;
  /** `Collects Cash` observado (`cashCollector`): COMPANY = false, VEHICLE_OWNER = true. */
  collectsCash: 'COMPANY' | 'VEHICLE_OWNER';
  /** Vehiculos de la ficha (el PUT vehicleOwners reenvia TODOS: riesgo de concurrencia entre pares). */
  vehicleIds: readonly number[];
  /**
   * true = armar/desarmar la automatica es seguro: la ficha tiene UN vehiculo y ningun otro par la usa.
   * false = ficha compartida (US 1481 4287 con P1/P2/P3; 1521 3287 con 1521/1521b): no armar sin aprobacion (D-4).
   */
  dedicatedForAuto: boolean;
  /** true = el usuario aprobo operar la ficha compartida (vehiculos de `vehicleIds` = QA); la guarda sigue verificando en ejecucion. */
  approvedShared?: boolean;
  /** Conceptos de `otherCosts` que la automatica usa para NC > 0 (R18) y NC = 0 (R19). */
  autoCosts: { nc: PrepCostSlot; com: PrepCostSlot };
  /** Comision por vehiculo leida de la ficha: % venta, % costo, beneficiario del % y fijo por dia. */
  vehicleCommissions: Readonly<
    Record<number, { pct: number; pctForCost: number; payee: 'AGENCY' | 'OWNER'; fixed: number }>
  >;
};

/** Ids para las liquidaciones (W4): choferes y propietario cuyos pendientes consume la liquidacion. */
export type PrepSettlement = {
  /** DRIVER.ID de los pares del perfil (la liquidacion de chofer es por chofer). */
  driverIds: readonly number[];
  ownerId: number;
  /** Vehiculos cuyas rendiciones entran en la liquidacion del propietario (todos los de la ficha). */
  ownerVehicleIds: readonly number[];
  /** true = la liquidacion del propietario incluye rendiciones de otros pares: exige aviso (D-4). */
  ownerSharedWithOtherPairs: boolean;
};

/** App Chofer real (Appium, solo TEST: D-8) para el cierre por app (W5). */
export type PrepApp = {
  package: string;
  version: string;
  udid: string;
  /** Etiqueta del chofer en la app (`Apellido, Nombre`). */
  driverLabel: string;
  /** NOMBRES de las variables con las credenciales del chofer (los valores nunca viven en el repo). */
  credentialEnv: { email: string; password: string };
  /** Archivo .env del repo Appium (magiis-playwright) donde viven esas variables. */
  credentialEnvFile: string;
  /** false = no se verifico que esas credenciales sean del chofer del par (hacerlo antes de W5b). */
  credentialsMatchPair: boolean;
};

export type CarrierPrepFacts = {
  customers: { cash: PrepCustomer; account: PrepCustomer | null };
  paymentMethods: { cash: string; account: string | null };
  otherCosts: Partial<Record<PrepCostSlot, PrepCost>>;
  pairs: Readonly<Record<string, PrepPair>>;
  defaultPair: string;
  /** Ficha del propietario del par por defecto (automatica). */
  owner: PrepOwner;
  /** Datos de liquidacion (W4). */
  settlement: PrepSettlement;
  /** App Chofer real; null = sin app (UAT es solo Playwright). */
  app: PrepApp | null;
};

export type CarrierProfile = {
  /** Id de seleccion (valor de CIRCUIT_CARRIER). */
  id: string;
  label: string;
  /** CARRIER.ID esperado en la sesion guardada. */
  carrierId: number;
  /** Ambiente del perfil (ver `ProfileEnv`). */
  env: ProfileEnv;
  /** Region de credenciales (`USER_CARRIER_<region>`) y de alta de viaje del circuito. */
  region: 'FR' | 'US' | 'AR';
  /** Archivo .env con credenciales y ids de fixture (solo se NOMBRA; los valores no viven aqui). */
  envFile: string;
  /** Prefijo de las variables de fixture: <PREFIX>_CLIENT_QUERY, <PREFIX>_DRIVER_ID, ... */
  envPrefix: string;
  /** Sufijo del storage state (`storage/state-carrier-<sufijo>-<env>.json`); null = ruta historica. */
  storageStateSuffix: string | null;
  locale: string;
  currency: { code: string; symbol: string };
  thousandsSeparator: ThousandsSeparator;
  /** Origen del reparto de comision sobre la venta del vehiculo del circuito. */
  commission: CommissionSource;
  cityTax: CityTax;
  fixtures: {
    /** OWNER.ID del propietario del vehiculo (override: FR_OWNER_ID). */
    ownerId: number;
    /** DRIVER.ID del chofer del circuito (reportes; los specs de viaje lo leen de <PREFIX>_DRIVER_ID). */
    driverDbId: number;
    /** CHECKINGACCOUNT.ID de la CC del cliente (reportes); null = N/A en este ambiente (UAT sin DB). */
    clientCcId: number | null;
    /** Dominio (patente) del vehiculo del circuito (override: FR_VEHICLE_DOMAIN); null = N/A. */
    vehicleDomain: string | null;
    /** Metodo de pago CC del alta (override: FR_CC_PAYMENT_METHOD). */
    ccPaymentMethod: string;
  };
  /** Datos de PREPARACION de viajes (alta + cierre administrativo). Opcional: 1901 usa `<PREFIX>_*` del entorno. */
  prep?: CarrierPrepFacts;
};

/** Borrador: cualquier hoja puede ser TODO. Las uniones (cityTax) se marcan TODO enteras. */
type Draft<T> = T extends string | number | boolean | RegExp
  ? T | Todo
  : T extends object
    ? { [K in keyof T]: Draft<T[K]> } | Todo
    : T | Todo;
export type CarrierProfileDraft = { [K in keyof CarrierProfile]: Draft<CarrierProfile[K]> };

const PROFILE_1901: CarrierProfile = {
  id: '1901',
  env: 'test',
  label: 'Francia 1901 (TEST, EUR)',
  carrierId: 1901,
  region: 'FR',
  envFile: '.env.test-fr',
  envPrefix: 'FR',
  // Ruta historica (storage/state-carrier-<env>.json): la corrida 1901 no cambia.
  storageStateSuffix: null,
  locale: 'en-US',
  currency: { code: 'EUR', symbol: '€' },
  // COUNTRY 1080 en NONE desde el 05/11 (SELECT en TEST): el 500 por SPACE ya no aplica.
  thousandsSeparator: 'NONE',
  // Comisiones sobre venta del vehiculo 3765 (datos-1901 lote B): propietario 40, chofer 40, agencia 20.
  commission: { kind: 'fixed', split: { owner: 0.4, driver: 0.4, agency: 0.2 } },
  cityTax: { present: true, conceptName: 'QA City Taxes', percent: 10 },
  fixtures: {
    ownerId: 2927,
    driverDbId: 4965,
    clientCcId: 5614,
    vehicleDomain: 'DNS207',
    ccPaymentMethod: 'Credit Account'
  }
};

/**
 * Esqueleto 1521 (TEST, Estados Unidos, USD). Todo lo que no se conoce es TODO hasta el descubrimiento:
 * cargarlo falla con la lista de pendientes.
 */
const PROFILE_1521: CarrierProfileDraft = {
  id: '1521',
  env: 'test',
  label: 'Estados Unidos 1521 (TEST, USD)',
  carrierId: 1521,
  region: 'US',
  envFile: '.env.test-us',
  envPrefix: 'US',
  storageStateSuffix: 'circuit-1521',
  locale: 'en-US',
  currency: { code: 'USD', symbol: '$' },
  // MAGIIS.COUNTRY 1007 (CARRIERACCOUNT 1521), SELECT en DB TEST 2026-11-05.
  thousandsSeparator: 'COMMA',
  // 1521: la comision real vive en DB (vehiculo 2625: 30 % + 30 fijo a AGENCY, chofer 0 %).
  commission: { kind: 'db' },
  // CARRIER_OTHER_COSTS de 1521 (SELECT TEST 11/11, 18 activos): ningun concepto de city tax.
  cityTax: { present: false },
  fixtures: {
    // VEHICLE 3849 -> VEHICLEOWNERID 3287 (SELECT TEST 11/11); DRIVER 5076; VEHICLEICARD.DOMAIN QAF5US.
    ownerId: 3287,
    driverDbId: 5076,
    // Sin cliente de cuenta corriente QA no bimonetario en 1521 (relevamiento 11/11): N/A.
    clientCcId: null,
    vehicleDomain: 'QAF5US',
    // Etiqueta leida del select de metodos de pago del alta 1521 (UI sin guardar, 11/11).
    ccPaymentMethod: 'Credit Account'
  },
  prep: {
    // Relevado el 11/11 (DB TEST solo lectura + UI del alta 1521 sin guardar ni enviar):
    // - Efectivo: pasajero individual «QUOTE, PAX» (PASSENGERACCOUNT 7085, tarifador Base, 0 viajes en 1521, no
    //   bimonetario). Sus medios de pago en el alta: Cash · Credit Card - On Board Charge · Credit Card -
    //   Pre-Authorized (sin Credit Account); default Cash. NO autocompleta origen: se escribe a mano (el typeahead
    //   por prefijo puede devolver otra calle: verificar la opcion en el dry-run de alta).
    // - Cuenta corriente: sin cliente apto. Unico QA con «Credit Account» es el contractor «QA F2 D3 Bimonetario»
    //   (1761, authorizer «Rep, QA D Tres»; D4 1781 analogo) pero es bimonetario (tarifadores 6202/6203): no se usa
    //   para F5 hasta decidir. Etiquetas del alta 1521: Cash · Credit Account · Credit Card - On Board Charge ·
    //   Credit Card - Pre-Authorized (sin QR); CARRIER_PAYMENT_METHODS_CONFIG activos: cash y checking account on.
    customers: {
      cash: {
        query: 'QUOTE, PAX',
        origin: '900 Collins Ave, Miami Beach',
        destination: '1111 Lincoln Rd, Miami Beach'
      },
      account: null
    },
    paymentMethods: { cash: 'Cash', account: 'Credit Account' },
    otherCosts: {
      // Efectivo (IS_BY_COST=0): 165 NC 10 · 164 COM 10. Cuenta corriente (IS_BY_COST=1): 147 NC 8/4 · 143 COM 10/6.
      cashNc: { id: 165, name: 'QA F2 V Fijo No Comisionable', fixed: 10, commissionable: false },
      cashCom: { id: 164, name: 'QA F2 V Fijo Comisionable', fixed: 10, commissionable: true },
      accountNc: {
        id: 147,
        name: 'QA F2 Fijo No Comisionable',
        fixed: 8,
        commissionable: false,
        byCost: true
      },
      accountCom: {
        id: 143,
        name: 'QA F2 Fijo Comisionable',
        fixed: 10,
        commissionable: true,
        byCost: true
      }
    },
    pairs: {
      // Etiquetas derivadas de MAGIISUSER (Apellido, Nombre) del DRIVER 5076/5096: confirmar en el select del alta.
      '1521': {
        driverId: 5076,
        driverLabel: 'Driver, QA Fcinco',
        vehicleId: 3849,
        ownerId: 3287,
        commission: { kind: 'db' },
        qaOwned: true
      },
      // Chofer QA de la suite TEST con credenciales ya cargadas en magiis-playwright/.env.test (DRIVER_EMAIL,
      // verificado por DB 11/11: DRIVER 3727, app 2.6.17). VEHICLE 2625 -> VEHICLEOWNERID 1806; el vehiculo lo
      // comparte el chofer 4426. Par usado por el cierre por app (W5b): F5_PREP_PAIR=1521-app.
      '1521-app': {
        driverId: 3727,
        driverLabel: 'argentoinfoa, pepe',
        vehicleId: 2625,
        ownerId: 1806,
        commission: { kind: 'db' },
        qaOwned: true
      },
      '1521b': {
        driverId: 5096,
        driverLabel: 'Costo, QA Fcinco',
        vehicleId: 3869,
        ownerId: 3287,
        commission: { kind: 'db' },
        qaOwned: true
      }
    },
    defaultPair: '1521',
    // GET vehicleOwners/3287 (TEST 11/11): ficha con 3 vehiculos QA (3849/3869/3870), cashCollector=false.
    // Compartida con el par 1521b: armar la automatica reenvia los tres (mismo cuidado que US UAT).
    owner: {
      ownerId: 3287,
      ownerLabel: 'QA F5 1521 Owner',
      collectsCash: 'COMPANY',
      vehicleIds: [3849, 3869, 3870],
      dedicatedForAuto: false,
      // Aprobado por el usuario 11/11/2026: los vehiculos de la ficha son de QA. En ejecucion se relee la ficha antes de armar y
      // antes de desarmar (vehiculo no listado o valores cambiados = aborta) y se compara por GET tras desarmar.
      approvedShared: true,
      autoCosts: { nc: 'cashNc', com: 'cashCom' },
      vehicleCommissions: {
        3849: { pct: 20, pctForCost: 0, payee: 'AGENCY', fixed: 0 },
        3869: { pct: 20, pctForCost: 10, payee: 'AGENCY', fixed: 0 },
        3870: { pct: 25, pctForCost: 0, payee: 'OWNER', fixed: 0 }
      }
    },
    settlement: {
      driverIds: [5076, 5096],
      ownerId: 3287,
      ownerVehicleIds: [3849, 3869, 3870],
      ownerSharedWithOtherPairs: true
    },
    // App Chofer de TEST (emulador, .env.emulator-test del repo Appium). Las credenciales DRIVER_EMAIL/PASSWORD de
    // su .env.test son las del carrier 1521, pero NO se verifico que sean las del chofer 5076: hacerlo antes de W5b.
    app: {
      package: 'com.magiis.app.test.driver',
      version: '2.6.17',
      // emulator-5556 (deslogueado 11/11); emulator-5554 tiene otra sesion (Chofer Futuro, 1040) y no se toca.
      udid: 'emulator-5556',
      driverLabel: 'argentoinfoa, pepe',
      credentialEnv: { email: 'DRIVER_EMAIL', password: 'DRIVER_PASSWORD' },
      credentialEnvFile: '.env.test',
      // DRIVER_EMAIL de .env.test = usuario del DRIVER 3727 (SELECT TEST 11/11): coincide con el par 1521-app.
      credentialsMatchPair: true
    }
  }
};

// ---------------------------------------------------------------------------------------------------
// Perfiles UAT (circuito administrativo multi-carrier, plan docs/qa/f5-admin-circuit-multicarrier-plan.md).
// Hechos de las notas de la regresion UAT del 10/11 (ar-1040-uat.md, us-1481-uat.md, fr-2021-uat.md).
// UAT no tiene DB: `clientCcId`/`vehicleDomain` en null = N/A. Credenciales y sesion: `.env.uat` (gitignored,
// USER/PASS_CARRIER_<region>) y `storage/state-carrier-<region>-uat.json`; el perfil solo NOMBRA los archivos.
// ---------------------------------------------------------------------------------------------------
const PROFILE_1040_UAT: CarrierProfile = {
  id: '1040-uat',
  env: 'uat',
  label: 'Argentina 1040 (UAT, ARS)',
  carrierId: 1040,
  region: 'AR',
  envFile: '.env.uat',
  envPrefix: 'AR',
  storageStateSuffix: 'ar',
  locale: 'en-US',
  currency: { code: 'ARS', symbol: '$' },
  thousandsSeparator: 'DOT',
  commission: { kind: 'fixed', split: { driver: 0, owner: 0.88, agency: 0.12 } },
  cityTax: { present: false },
  fixtures: {
    ownerId: 4288,
    driverDbId: 6441,
    clientCcId: null,
    vehicleDomain: 'QAF5UA',
    // Descubierto por UI solo lectura (11/11, atajo «Seba»): opciones Cash · Credit Account · Credit Card
    // On Board/Pre-Authorized · QR; el default del atajo es «Credit Account» (DB: CHECKING_ACCOUNT).
    ccPaymentMethod: 'Credit Account'
  },
  prep: {
    customers: {
      // «Seba» es el atajo de pasajero (boton) y trae un origen autocompletado que el alta sobrescribe.
      cash: { shortcut: 'Seba', origin: 'San Martín 536', destination: 'Av. Corrientes 1502' },
      account: { shortcut: 'Seba', origin: 'San Martín 536', destination: 'Av. Corrientes 1502' }
    },
    paymentMethods: { cash: 'Cash', account: 'Credit Account' },
    otherCosts: {
      cashCom: { id: 278, name: 'QA F2F3 UAT Fijo Venta', fixed: 1000, commissionable: true },
      cashNc: {
        id: 279,
        name: 'QA F2F3 UAT Venta No Comisionable',
        fixed: 1000,
        commissionable: false
      }
    },
    pairs: {
      default: {
        driverId: 6441,
        driverLabel: 'UAT AR, QA Fcinco',
        vehicleId: 5355,
        ownerId: 4288,
        commission: { kind: 'fixed', split: { driver: 0, owner: 0.88, agency: 0.12 } },
        qaOwned: true
      }
    },
    defaultPair: 'default',
    // GET vehicleOwners/4288 (11/11): un solo vehiculo (5355), cashCollector=false. La ficha trae ademas un
    // fijo de 122 por dia a la AGENCIA (no modelado en `commission`: el oraculo lo lee de la corrida).
    owner: {
      ownerId: 4288,
      ownerLabel: 'QA F5 UAT AR Owner',
      collectsCash: 'COMPANY',
      vehicleIds: [5355],
      dedicatedForAuto: true,
      autoCosts: { nc: 'cashNc', com: 'cashCom' },
      vehicleCommissions: { 5355: { pct: 12, pctForCost: 0, payee: 'AGENCY', fixed: 122 } }
    },
    settlement: {
      driverIds: [6441],
      ownerId: 4288,
      ownerVehicleIds: [5355],
      ownerSharedWithOtherPairs: false
    },
    app: null
  }
};

const PROFILE_1481_UAT: CarrierProfile = {
  id: '1481-uat',
  env: 'uat',
  label: 'Estados Unidos 1481 (UAT, USD)',
  carrierId: 1481,
  region: 'US',
  envFile: '.env.uat',
  envPrefix: 'US',
  storageStateSuffix: 'us',
  locale: 'en-US',
  currency: { code: 'USD', symbol: '$' },
  thousandsSeparator: 'COMMA',
  // Default = P1 (40/40/20); el reparto real por par vive en `prep.pairs`.
  commission: { kind: 'fixed', split: { driver: 0.4, owner: 0.4, agency: 0.2 } },
  cityTax: { present: false },
  fixtures: {
    // Una sola ficha de propietario (4287) para los 3 vehiculos.
    ownerId: 4287,
    driverDbId: 6437,
    clientCcId: null,
    vehicleDomain: null,
    ccPaymentMethod: 'Credit Account'
  },
  prep: {
    customers: {
      // Efectivo: pasajero individual (sin Authorizer); el origen lo autocompleta el cliente.
      cash: {
        query: 'Pax Venta',
        optionText: 'Pax Venta, QA Fdos UAT',
        origin: null,
        destination: '1111 Lincoln Rd, Miami Beach'
      },
      // Cuenta corriente: contractor + Authorizer; tarifa por costo; origen manual.
      account: {
        query: 'QA F2F3 UAT 1481',
        authorizer: 'Representante',
        origin: '900 Collins Ave, Miami Beach',
        destination: '1111 Lincoln Rd, Miami Beach'
      }
    },
    paymentMethods: { cash: 'Cash', account: 'Credit Account' },
    otherCosts: {
      cashNc: { id: 291, name: 'QA F5 UAT NC', fixed: 10, commissionable: false },
      cashCom: { id: 292, name: 'QA F5 UAT COM', fixed: 10, commissionable: true },
      // Contractor por costo: solo conceptos IS_BY_COST=1 (venta 8 / costo 4; venta 10 / costo 6).
      accountNc: {
        id: 284,
        name: 'QA F2F3 UAT 1481 Costo No Com',
        fixed: 8,
        commissionable: false,
        byCost: true
      },
      accountCom: {
        id: 283,
        name: 'QA F2F3 UAT 1481 Costo Com',
        fixed: 10,
        commissionable: true,
        byCost: true
      }
    },
    pairs: {
      P1: {
        driverId: 6437,
        driverLabel: 'Uno, QA Fcinco',
        vehicleId: 5352,
        ownerId: 4287,
        commission: { kind: 'fixed', split: { driver: 0.4, owner: 0.4, agency: 0.2 } },
        qaOwned: true
      },
      P2: {
        driverId: 6438,
        driverLabel: 'Dos, QA Fcinco',
        vehicleId: 5353,
        ownerId: 4287,
        // Venta 40/40/20; el bloque «Costo» (0/90/10) depende del costo del vehiculo y se LEE en la corrida.
        commission: { kind: 'fixed', split: { driver: 0.4, owner: 0.4, agency: 0.2 } },
        qaOwned: true
      },
      P3: {
        driverId: 6439,
        // Etiqueta usada en la finalizacion del 06/11 (viaje 723595, us-1481-uat.md).
        driverLabel: 'Tres, QA Fcinco',
        vehicleId: 5354,
        ownerId: 4287,
        // Comision 25 % con payee OWNER: reparto no fijado, se lee de la configuracion.
        commission: { kind: 'db' },
        qaOwned: true
      }
    },
    defaultPair: 'P1',
    // GET vehicleOwners/4287 (11/11): ficha con los 3 vehiculos QA (5352/5353/5354), cashCollector=false. Compartida
    // entre P1/P2/P3: armar la automatica o liquidar el propietario afecta a los tres (D-4: no sin aprobacion).
    owner: {
      ownerId: 4287,
      ownerLabel: 'QA F5 UAT US Owner',
      collectsCash: 'COMPANY',
      vehicleIds: [5352, 5353, 5354],
      dedicatedForAuto: false,
      // Aprobado por el usuario 11/11/2026: los vehiculos de la ficha son de QA. En ejecucion se relee la ficha antes de armar y
      // antes de desarmar (vehiculo no listado o valores cambiados = aborta) y se compara por GET tras desarmar.
      approvedShared: true,
      autoCosts: { nc: 'cashNc', com: 'cashCom' },
      vehicleCommissions: {
        5352: { pct: 20, pctForCost: 0, payee: 'AGENCY', fixed: 0 },
        5353: { pct: 20, pctForCost: 10, payee: 'AGENCY', fixed: 0 },
        5354: { pct: 25, pctForCost: 0, payee: 'OWNER', fixed: 0 }
      }
    },
    settlement: {
      driverIds: [6437, 6438, 6439],
      ownerId: 4287,
      ownerVehicleIds: [5352, 5353, 5354],
      ownerSharedWithOtherPairs: true
    },
    app: null
  }
};

const PROFILE_2021_UAT: CarrierProfile = {
  id: '2021-uat',
  env: 'uat',
  label: 'Francia 2021 (UAT, EUR)',
  carrierId: 2021,
  region: 'FR',
  envFile: '.env.uat',
  envPrefix: 'FR',
  storageStateSuffix: 'fr',
  locale: 'en-US',
  currency: { code: 'EUR', symbol: '€' },
  thousandsSeparator: 'NONE',
  commission: { kind: 'fixed', split: { driver: 0.4, owner: 0.4, agency: 0.2 } },
  cityTax: { present: true, conceptName: 'QA F5 UAT City Taxes', percent: 10 },
  fixtures: {
    ownerId: 4289,
    driverDbId: 6440,
    clientCcId: 6472,
    vehicleDomain: 'QAF5UAT-FR1',
    ccPaymentMethod: 'Credit Account'
  },
  prep: {
    customers: {
      cash: {
        query: 'FR Pax',
        origin: null, // el pax autocompleta «12 Rue d'Antibes, Cannes» (verificado por UI 11/11)
        destination: 'Boulevard de la Croisette'
      },
      account: {
        query: 'FR Pax',
        origin: null, // el pax autocompleta «12 Rue d'Antibes, Cannes» (verificado por UI 11/11)
        destination: 'Boulevard de la Croisette'
      }
    },
    paymentMethods: { cash: 'Cash', account: 'Credit Account' },
    otherCosts: {
      cashNc: { id: 293, name: 'QA F5 UAT NC', fixed: 15, commissionable: false },
      cashCom: { id: 294, name: 'QA F5 UAT City Taxes', percent: 10, commissionable: true },
      accountNc: { id: 293, name: 'QA F5 UAT NC', fixed: 15, commissionable: false }
    },
    pairs: {
      default: {
        driverId: 6440,
        driverLabel: 'UAT FR, QA Fcinco',
        vehicleId: 5356,
        ownerId: 4289,
        commission: { kind: 'fixed', split: { driver: 0.4, owner: 0.4, agency: 0.2 } },
        qaOwned: true
      }
    },
    defaultPair: 'default',
    // GET vehicleOwners/4289 (11/11): un solo vehiculo (5356), cashCollector=false.
    owner: {
      ownerId: 4289,
      ownerLabel: 'QA F5 UAT FR Owner',
      collectsCash: 'COMPANY',
      vehicleIds: [5356],
      dedicatedForAuto: true,
      autoCosts: { nc: 'cashNc', com: 'cashCom' },
      vehicleCommissions: { 5356: { pct: 20, pctForCost: 0, payee: 'AGENCY', fixed: 0 } }
    },
    settlement: {
      driverIds: [6440],
      ownerId: 4289,
      ownerVehicleIds: [5356],
      ownerSharedWithOtherPairs: false
    },
    app: null
  }
};

const REGISTRY: Readonly<Record<string, CarrierProfile | CarrierProfileDraft>> = {
  '1901': PROFILE_1901,
  '1521': PROFILE_1521,
  '1040-uat': PROFILE_1040_UAT,
  '1481-uat': PROFILE_1481_UAT,
  '2021-uat': PROFILE_2021_UAT
};

export function knownCircuitCarriers(): string[] {
  return Object.keys(REGISTRY);
}

/** true si CIRCUIT_CARRIER esta seteada (no vacia): solo entonces el perfil gobierna env file y storage. */
export function isCircuitCarrierExplicit(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CIRCUIT_CARRIER?.trim());
}

/** Id del perfil activo: CIRCUIT_CARRIER o `1901`. Un id desconocido lanza (nunca cae en 1901). */
export function resolveCircuitCarrierId(env: NodeJS.ProcessEnv = process.env): string {
  const id = env.CIRCUIT_CARRIER?.trim() || DEFAULT_CIRCUIT_CARRIER;
  if (!(id in REGISTRY)) {
    throw new Error(
      `CIRCUIT_CARRIER="${id}" desconocido: perfiles disponibles ${knownCircuitCarriers().join(', ')}`
    );
  }
  return id;
}

/** Borrador del perfil SIN validar pendientes: para campos siempre conocidos (env file, storage, locale). */
export function peekCarrierProfile(
  id: string = resolveCircuitCarrierId()
): CarrierProfile | CarrierProfileDraft {
  const profile = REGISTRY[id];
  if (!profile) {
    throw new Error(
      `CIRCUIT_CARRIER="${id}" desconocido: perfiles disponibles ${knownCircuitCarriers().join(', ')}`
    );
  }
  return profile;
}

function isTodo(value: unknown): value is Todo {
  return typeof value === 'object' && value !== null && (value as Todo).__todo === true;
}

/** Rutas (p. ej. `fixtures.ownerId`) de los campos TODO del perfil. */
export function todoFields(id: string = resolveCircuitCarrierId()): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (isTodo(node)) {
      out.push(path);
      return;
    }
    if (typeof node !== 'object' || node === null || node instanceof RegExp) return;
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(peekCarrierProfile(id), '');
  return out;
}

/** ENV efectivo (misma regla que `getCurrentEnv`, sin importar runtime.ts: evita el ciclo de imports). */
function activeEnv(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.ENV?.trim();
  return raw === 'uat' || raw === 'prod' ? raw : 'test';
}

/**
 * Un perfil nunca opera en otro ambiente que el suyo: uno `uat` exige ENV=uat; uno `test` con ENV=uat lanza solo
 * si el perfil se eligio explicitamente (CIRCUIT_CARRIER): el default implicito `1901` no cambia de comportamiento.
 */
export function assertProfileEnv(
  profile: { id: string; env: ProfileEnv },
  env: NodeJS.ProcessEnv = process.env
): void {
  const active = activeEnv(env);
  const mismatch =
    profile.env === 'uat' ? active !== 'uat' : active === 'uat' && isCircuitCarrierExplicit(env);
  if (mismatch) {
    throw new Error(
      `Perfil de carrier "${profile.id}" es de ambiente ${profile.env} pero ENV=${active}: ` +
        `no se mezclan ambientes (datos de otro carrier).`
    );
  }
}

/** Perfil completo y validado. Lanza con TODOS los campos pendientes si el perfil es un esqueleto. */
export function loadCarrierProfile(id: string = resolveCircuitCarrierId()): CarrierProfile {
  const peeked = peekCarrierProfile(id);
  if (typeof peeked.env === 'string') assertProfileEnv({ id, env: peeked.env });
  const pending = todoFields(id);
  if (pending.length > 0) {
    throw new Error(
      `Perfil de carrier "${id}" incompleto (descubrimiento pendiente): ${pending.join(', ')}. ` +
        `Completar en tests/config/carrier-profiles.ts; no se usan valores de otro carrier.`
    );
  }
  return peekCarrierProfile(id) as CarrierProfile;
}

/**
 * Carga acotada: lanza solo si hay TODO dentro de los prefijos pedidos (p. ej. `['prep.owner', 'prep.settlement']`);
 * los pendientes de otras secciones no bloquean. Para el perfil 1521, cuyo alta (cliente, metodos de pago) sigue
 * pendiente, permite a W3/W4/W5a leer propietario, liquidacion y app sin esperar el descubrimiento del alta.
 */
export function loadCarrierProfileScoped(id: string, scopes: readonly string[]): CarrierProfile {
  const peeked = peekCarrierProfile(id);
  if (typeof peeked.env === 'string') assertProfileEnv({ id, env: peeked.env });
  const pending = todoFields(id).filter((path) =>
    scopes.some(
      (scope) => path === scope || path.startsWith(`${scope}.`) || scope.startsWith(`${path}.`)
    )
  );
  if (pending.length > 0) {
    throw new Error(
      `Perfil de carrier "${id}" incompleto en ${scopes.join(', ')} (descubrimiento pendiente): ${pending.join(', ')}.`
    );
  }
  return peeked as CarrierProfile;
}

/** Datos de preparacion del perfil; lanza si el perfil no los declara (p. ej. 1901 usa `<PREFIX>_*` del entorno). */
export function requirePrep(profile: CarrierProfile): CarrierPrepFacts {
  if (!profile.prep) {
    throw new Error(
      `Perfil de carrier "${profile.id}" sin datos de preparacion (prep): usar un perfil UAT ` +
        `(${knownCircuitCarriers()
          .filter((k) => k.endsWith('-uat'))
          .join(', ')}).`
    );
  }
  return profile.prep;
}

/** Par PROPIO de QA del perfil (`key` o `prep.defaultPair`); lanza si no existe o no es `qaOwned`. */
export function prepPair(profile: CarrierProfile, key?: string): { key: string; pair: PrepPair } {
  const prep = requirePrep(profile);
  const k = key?.trim() || prep.defaultPair;
  const pair = prep.pairs[k];
  if (!pair || pair.qaOwned !== true) {
    throw new Error(
      `Par "${k}" no declarado como propio (qaOwned) en el perfil "${profile.id}": ` +
        `disponibles ${Object.keys(prep.pairs).join(', ')}`
    );
  }
  return { key: k, pair };
}

/** Ficha de propietario del perfil (automatica, W3). */
export function prepOwner(profile: CarrierProfile): PrepOwner {
  return requirePrep(profile).owner;
}

/**
 * Guarda de ARMADO de la automatica: la ficha debe ser dedicada (un vehiculo, sin otros pares). Lanza con el motivo
 * (D-4: el PUT vehicleOwners reenvia todos los vehiculos de la ficha) salvo `approvedShared` explicito.
 */
export function assertOwnerDedicatedForAuto(
  profile: CarrierProfile,
  opts: { approvedShared?: boolean } = {}
): PrepOwner {
  const owner = prepOwner(profile);
  if (!owner.dedicatedForAuto && opts.approvedShared !== true && owner.approvedShared !== true) {
    throw new Error(
      `Propietario ${owner.ownerId} del perfil "${profile.id}" no es dedicado (vehiculos ${owner.vehicleIds.join(', ')} ` +
        `en la misma ficha): la automatica reenvia todos al armar/desarmar; requiere aprobacion explicita (D-4).`
    );
  }
  return owner;
}

/** Datos de liquidacion del perfil (W4). */
export function prepSettlement(profile: CarrierProfile): PrepSettlement {
  return requirePrep(profile).settlement;
}

/** App Chofer real del perfil; lanza si no la declara (UAT es solo Playwright; la app real es solo TEST). */
export function requirePrepApp(profile: CarrierProfile): PrepApp {
  const app = requirePrep(profile).app;
  if (!app) {
    throw new Error(
      `Perfil de carrier "${profile.id}" sin app Chofer (prep.app = null): la app real corre solo en TEST ` +
        `(build 2.6.17); UAT se prueba solo con Playwright.`
    );
  }
  return app;
}

/** Matcher de moneda (`profile.currency`): `/EUR|€/i` con simbolo; `/EUR/i` solo con codigo. */
export function currencyMatcher(
  currency: CarrierProfile['currency'],
  opts: { symbol?: boolean } = { symbol: true }
): RegExp {
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const { code, symbol } = currency;
  return new RegExp(opts.symbol === false ? esc(code) : `${esc(code)}|${esc(symbol)}`, 'i');
}

/** Fraccion del city tax (0.1 = 10 %); 0 si el perfil declara que el concepto no existe. */
export function cityTaxFraction(profile: CarrierProfile): number {
  return profile.cityTax.present ? profile.cityTax.percent / 100 : 0;
}

let registeredSettings: CommissionSettings | null = null;

/** Registra la configuracion leida de DB (perfiles `db`); `null` la limpia. */
export function registerCommissionSettings(settings: CommissionSettings | null): void {
  registeredSettings = settings;
}

function requireRegistered(profile: CarrierProfile): CommissionSettings {
  if (!registeredSettings) {
    throw new Error(
      `Comision del carrier "${profile.id}" viene de DB: llamar a ensureCommissionResolved ` +
        `(tests/steps/trips/commissionSettings.steps.ts) antes de usar el reparto.`
    );
  }
  return registeredSettings;
}

/** Reparto del perfil: constante (`fixed`) o derivado de la configuracion registrada (`db`). */
export function resolveCommissionSplit(
  profile: CarrierProfile,
  settings: CommissionSettings | null = registeredSettings
): CommissionSplit {
  if (profile.commission.kind === 'fixed') return profile.commission.split;
  return splitFromSettings(settings ?? requireRegistered(profile));
}

/** Comision fija por dia de viaje por beneficiario (0/0 en perfiles `fixed`). */
export function resolveCommissionFixed(
  profile: CarrierProfile,
  settings: CommissionSettings | null = registeredSettings
): { owner: number; agency: number } {
  if (profile.commission.kind === 'fixed') return { owner: 0, agency: 0 };
  return fixedPerDay(settings ?? requireRegistered(profile));
}

/**
 * Reparto de comision del perfil activo, resuelto al LEER cada campo (no al importar): importar un
 * modulo del circuito con un perfil esqueleto no rompe; usar el reparto si.
 */
export const COMMISSION_SPLIT: CommissionSplit = {
  get owner(): number {
    return resolveCommissionSplit(loadCarrierProfile()).owner;
  },
  get driver(): number {
    return resolveCommissionSplit(loadCarrierProfile()).driver;
  },
  get agency(): number {
    return resolveCommissionSplit(loadCarrierProfile()).agency;
  }
};

/** Comision fija POR DIA de viaje del perfil activo (propietario / agencia). */
export const COMMISSION_FIXED: { readonly owner: number; readonly agency: number } = {
  get owner(): number {
    return resolveCommissionFixed(loadCarrierProfile()).owner;
  },
  get agency(): number {
    return resolveCommissionFixed(loadCarrierProfile()).agency;
  }
};
