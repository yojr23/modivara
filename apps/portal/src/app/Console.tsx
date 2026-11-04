import { ApiRequestError, usePlatformOrganizations, useSetActingOrganization } from '@modivara/core-web';
import { platform, useTables } from '@modivara/hospitality-web';
import type { DeviceDto, GatewayDto } from '@modivara/hospitality-contracts';
import { Cable, Copy, Radio, ToyBrick } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { fmtWhen } from './format';
import { Bone, EmptyState, ErrorState, Modal, Page, Segmented, useApp, useToast } from './ui';

// F2-14 / F3-15 — consola de superadmin (H3). Permisos `platform.*` (solo el superadmin), sin módulo.
// Flujo: negocio (PUT acting-organization) → local → pestañas. Hospitality toma el negocio de la sesión, no de la URL.

const field = 'mt-1 block h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-sm text-fg';
const TABS = [['gateways', 'Gateways'], ['botones', 'Botones'], ['detectados', 'Detectados sin asignar']] as const;
type Tab = (typeof TABS)[number][0];

const BY_CODE: Record<string, string> = {
  gateway_in_use: 'Es el último gateway del local y hay botones asignados: desasígnalos o agrega otro gateway antes.',
  duplicate: 'Ya hay un botón con ese código en este local.',
  device_already_assigned: 'Ese botón ya está asignado a otra mesa: desasígnalo primero.',
  not_found: 'Ya no existe (o no es de este local). Recarga la lista.',
  permission_denied: 'No tienes permiso de plataforma para hacerlo.',
  module_disabled: 'Este negocio no tiene contratado el módulo de llamados (hospitality).',
  location_unavailable: 'El local no está disponible. Elige el negocio y el local de nuevo.',
  validation: 'Hay datos que el servidor no aceptó. Revísalos.',
  session_invalid: 'Tu sesión venció. Entra de nuevo.',
};
const say = (e: unknown, fallback: string) => (e instanceof ApiRequestError && BY_CODE[e.code]) || fallback;

/** Mesas del local (para asignar un botón). Con acting-organization, `GET /locations/:l/tables` ya sirve el negocio elegido. */
function TableSelect({ l, label, value, onChange }: { l: string; label: string; value: string; onChange: (v: string) => void }) {
  const tables = useTables(l);
  return (
    <label className="text-sm text-muted">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={tables.isPending} className={field}>
        <option value="">{tables.isError ? 'No se pudieron cargar las mesas' : 'Elige una mesa'}</option>
        {(tables.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
      </select>
    </label>
  );
}

const Loading = ({ what }: { what: string }) => <div role="status" aria-label={`Cargando ${what}`} className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Bone key={i} className="h-12 w-full" />)}</div>;
const Row = ({ children }: { children: React.ReactNode }) => <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-surface p-3 text-sm">{children}</li>;

function NewKey({ gateway, onClose, onCopy }: { gateway: { name: string; key: string }; onClose: () => void; onCopy: (t: string) => void }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(gateway.key);
      onCopy('Clave copiada.');
    } catch {
      onCopy('No se pudo copiar: selecciónala y cópiala a mano.');
    }
  }
  return (
    <section aria-label={`Clave de ${gateway.name}`} className="space-y-3 rounded-lg border border-line-strong bg-surface p-4 text-sm">
      <h3 className="font-semibold">Clave de «{gateway.name}»</h3>
      <p role="note" className="text-muted">Cópiala y guárdala ahora: es la única vez que se muestra. Si la pierdes, crea otro gateway y desactiva este.</p>
      <code className="block break-all rounded-md bg-sunken p-3 select-all">{gateway.key}</code>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={copy}><Copy aria-hidden className="size-4" />Copiar clave</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Ya la guardé</Button>
      </div>
    </section>
  );
}

function ConfirmGateway({ l, gateway, onClose, onDone }: { l: string; gateway: GatewayDto; onClose: () => void; onDone: () => void }) {
  const deactivate = platform.useDeactivateGateway(l);
  const [error, setError] = useState('');
  async function go() {
    setError('');
    try {
      await deactivate.mutateAsync(gateway.id);
      onDone();
    } catch (e) {
      setError(say(e, 'No se pudo desactivar. Intenta de nuevo.'));
    }
  }
  return (
    <Modal label={`Desactivar gateway ${gateway.name}`} onClose={onClose}>
      <h2 className="mb-2 text-lg font-bold">Desactivar gateway {gateway.name}</h2>
      <p className="mb-4 text-sm text-muted">Deja de aceptar pulsaciones con su clave. No se puede reactivar: tendrías que crear otro.</p>
      {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" autoFocus onClick={onClose}>Cancelar</Button>
        <Button size="sm" variant="secondary" className="text-danger" disabled={deactivate.isPending} onClick={go}>Desactivar</Button>
      </div>
    </Modal>
  );
}

function Gateways({ l, tz, toast }: { l: string; tz: string; toast: (t: string) => void }) {
  const q = platform.useGateways(l);
  const create = platform.useCreateGateway(l);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [closing, setClosing] = useState<GatewayDto | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Escribe un nombre para el gateway.');
    setError('');
    try {
      const g = await create.mutateAsync({ name: name.trim() });
      setCreated({ name: g.name, key: g.key });
      setName('');
    } catch (err) {
      setError(say(err, 'No se pudo crear el gateway. Intenta de nuevo.'));
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-56 text-sm text-muted">Nombre del gateway
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" className={field} />
        </label>
        <Button type="submit" disabled={create.isPending}>Crear gateway</Button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {created && <NewKey gateway={created} onClose={() => setCreated(null)} onCopy={toast} />}
      {q.isPending ? <Loading what="gateways" />
        : q.isError ? <ErrorState what="los gateways" onRetry={() => void q.refetch()} error={q.error} />
        : q.data.length === 0 ? <EmptyState Icon={Radio} title="Este local no tiene gateways" text="Crea el primero: sin gateway los botones no pueden reportar." />
        : (
          <ul aria-label="Gateways" className="space-y-2">
            {q.data.map((g) => (
              <Row key={g.id}>
                <b className="min-w-0 flex-1 basis-40 truncate font-semibold">{g.name}</b>
                <span className={g.connected ? 'font-semibold' : 'font-semibold text-muted'}>{g.connected ? 'Conectado' : 'Sin señal'}</span>
                <span className="text-muted">{g.last_seen_at ? `Última señal: ${fmtWhen(g.last_seen_at, tz)}` : 'Nunca ha dado señal'}</span>
                <Button size="sm" variant="ghost" className="text-danger" aria-label={`Desactivar ${g.name}`} onClick={() => setClosing(g)}>Desactivar</Button>
              </Row>
            ))}
          </ul>
        )}
      {closing && <ConfirmGateway l={l} gateway={closing} onClose={() => setClosing(null)} onDone={() => { toast(`Gateway «${closing.name}» desactivado.`); setClosing(null); }} />}
    </div>
  );
}

function DeviceRow({ l, d, tableName, toast }: { l: string; d: DeviceDto; tableName?: string; toast: (t: string) => void }) {
  const assign = platform.useAssignDevice(l);
  const unassign = platform.useUnassignDevice(l);
  const [tableId, setTableId] = useState('');
  const [error, setError] = useState('');
  async function run(fn: () => Promise<unknown>, ok: string, fail: string) {
    setError('');
    try {
      await fn();
      toast(ok);
    } catch (e) {
      setError(say(e, fail));
    }
  }
  return (
    <Row>
      <span className="min-w-0 flex-1 basis-40"><b className="block truncate font-semibold">{d.code}</b>{d.model && <span className="text-muted">{d.model}</span>}</span>
      {d.table_id ? (
        <>
          <span>Mesa: <b className="font-semibold">{tableName ?? 'Mesa desactivada'}</b></span>
          <Button size="sm" variant="secondary" aria-label={`Desasignar ${d.code}`} disabled={unassign.isPending} onClick={() => run(() => unassign.mutateAsync(d.id), `Botón ${d.code} desasignado.`, 'No se pudo desasignar.')}>Desasignar</Button>
        </>
      ) : (
        <>
          <span className="text-muted">Sin asignar</span>
          <TableSelect l={l} label={`Mesa de ${d.code}`} value={tableId} onChange={setTableId} />
          <Button size="sm" variant="secondary" aria-label={`Asignar ${d.code}`} disabled={!tableId || assign.isPending} onClick={() => run(() => assign.mutateAsync({ deviceId: d.id, tableId }), `Botón ${d.code} asignado.`, 'No se pudo asignar.')}>Asignar</Button>
        </>
      )}
      {error && <p role="alert" className="basis-full text-danger">{error}</p>}
    </Row>
  );
}

function Devices({ l, toast }: { l: string; toast: (t: string) => void }) {
  const q = platform.useDevices(l);
  const tables = useTables(l);
  const create = platform.useCreateDevice(l);
  const [code, setCode] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState('');
  const names = new Map((tables.data ?? []).map((t) => [t.id, t.display_name]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setError('Escribe el código del botón (el que viene impreso o en la etiqueta).');
    setError('');
    try {
      await create.mutateAsync({ code: code.trim(), ...(model.trim() ? { model: model.trim() } : {}) });
      toast(`Botón ${code.trim()} creado.`);
      setCode('');
      setModel('');
    } catch (err) {
      setError(say(err, 'No se pudo crear el botón. Intenta de nuevo.'));
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-40 text-sm text-muted">Código del botón
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={64} autoComplete="off" className={field} />
        </label>
        <label className="min-w-0 flex-1 basis-40 text-sm text-muted">Modelo (opcional)
          <input value={model} onChange={(e) => setModel(e.target.value)} maxLength={64} autoComplete="off" className={field} />
        </label>
        <Button type="submit" disabled={create.isPending}>Crear botón</Button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {q.isPending ? <Loading what="botones" />
        : q.isError ? <ErrorState what="los botones" onRetry={() => void q.refetch()} error={q.error} />
        : q.data.length === 0 ? <EmptyState Icon={ToyBrick} title="Este local no tiene botones" text="Créalos aquí o registra los detectados sin asignar." />
        : <ul aria-label="Botones" className="space-y-2">{q.data.map((d) => <DeviceRow key={d.id} l={l} d={d} tableName={d.table_id ? names.get(d.table_id) : undefined} toast={toast} />)}</ul>}
    </div>
  );
}

function UnknownRow({ l, tz, code, count, last, toast }: { l: string; tz: string; code: string; count: number; last: string; toast: (t: string) => void }) {
  const create = platform.useCreateDevice(l);
  const assign = platform.useAssignDevice(l);
  const [tableId, setTableId] = useState('');
  const [error, setError] = useState('');
  async function go() {
    setError('');
    let device: DeviceDto;
    try {
      device = await create.mutateAsync({ code });
    } catch (e) {
      return setError(say(e, 'No se pudo registrar el botón.'));
    }
    try {
      await assign.mutateAsync({ deviceId: device.id, tableId });
      toast(`Botón ${code} registrado y asignado.`);
    } catch (e) {
      setError(`Se registró, pero no se pudo asignar: ${say(e, 'error desconocido')} Termínalo en la pestaña Botones.`);
    }
  }
  return (
    <Row>
      <span className="min-w-0 flex-1 basis-40"><b className="block truncate font-semibold">{code}</b><span className="text-muted">{count === 1 ? '1 pulsación' : `${count} pulsaciones`} · última {fmtWhen(last, tz)}</span></span>
      <TableSelect l={l} label={`Mesa de ${code}`} value={tableId} onChange={setTableId} />
      <Button size="sm" variant="secondary" aria-label={`Registrar y asignar ${code}`} disabled={!tableId || create.isPending || assign.isPending} onClick={go}>Registrar y asignar</Button>
      {error && <p role="alert" className="basis-full text-danger">{error}</p>}
    </Row>
  );
}

// ponytail: ventana por defecto de la API (7 días); sin selector de fechas hasta que haga falta.
function Unknown({ l, tz, toast }: { l: string; tz: string; toast: (t: string) => void }) {
  const q = platform.useUnknownDevices(l);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Códigos que pulsaron sin estar registrados en este local, de los últimos 7 días.</p>
      {q.isPending ? <Loading what="detectados" />
        : q.isError ? <ErrorState what="los detectados" onRetry={() => void q.refetch()} error={q.error} />
        : q.data.length === 0 ? <EmptyState Icon={Radio} title="Nada sin asignar" text="Cuando un botón no registrado pulse, aparecerá aquí." />
        : <ul aria-label="Detectados sin asignar" className="space-y-2">{q.data.map((u) => <UnknownRow key={u.device_code} l={l} tz={tz} code={u.device_code} count={u.count} last={u.last_seen_at} toast={toast} />)}</ul>}
    </div>
  );
}

export default function Console() {
  const { me } = useApp();
  const orgs = usePlatformOrganizations();
  const act = useSetActingOrganization();
  const toast = useToast();
  const actingId = me.actor.acting_organization_id;
  const [locationId, setLocationId] = useState('');
  const [tab, setTab] = useState<Tab>('gateways');
  const [error, setError] = useState('');

  // Al salir de la consola se deja de actuar sobre el negocio (y `/me` se relee). ponytail: en desarrollo (StrictMode) también corre al montar.
  const acting = useRef(actingId);
  acting.current = actingId;
  const { mutate } = act;
  useEffect(() => () => { if (acting.current) mutate(null); }, [mutate]);

  const org = orgs.data?.find((o) => o.id === actingId);
  const places = org?.locations.filter((x) => x.active) ?? [];
  const place = places.find((x) => x.id === locationId) ?? places[0];

  async function choose(id: string) {
    setError('');
    setLocationId('');
    try {
      await act.mutateAsync(id || null);
    } catch (e) {
      setError(say(e, 'No se pudo cambiar de negocio. Intenta de nuevo.'));
    }
  }

  return (
    <Page id="consola" title="Consola" subtitle={org ? `Actuando en ${org.name}` : 'Plataforma'}>
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 basis-56 text-sm text-muted">Negocio
            <select value={actingId ?? ''} onChange={(e) => void choose(e.target.value)} disabled={orgs.isPending || act.isPending} className={field}>
              <option value="">Elige un negocio</option>
              {(orgs.data ?? []).map((o) => <option key={o.id} value={o.id} disabled={!o.active}>{o.active ? o.name : `${o.name} (inactivo)`}</option>)}
            </select>
          </label>
          {org && (
            <label className="min-w-0 basis-56 text-sm text-muted">Local
              <select value={place?.id ?? ''} onChange={(e) => setLocationId(e.target.value)} className={field}>
                {places.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          )}
          {org && <Button variant="ghost" disabled={act.isPending} onClick={() => void choose('')}>Dejar de actuar</Button>}
        </div>
        {org && <p role="status" className="text-sm"><Cable aria-hidden className="mr-1 inline size-4 align-text-bottom" />Estás actuando en <b className="font-semibold">{org.name}</b>: lo que hagas aquí afecta a ese negocio.</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        {orgs.isError ? <ErrorState what="los negocios" onRetry={() => void orgs.refetch()} error={orgs.error} />
          : !org ? <EmptyState Icon={Cable} title="Elige un negocio" text="Con un negocio elegido podrás gestionar los gateways y botones de sus locales." />
          : !place ? <EmptyState Icon={Radio} title="Este negocio no tiene locales activos" text="Crea un local para poder registrar gateways y botones." />
          : (
            <>
              <Segmented label="Sección" options={TABS} value={tab} onChange={setTab} />
              {/* `key` por local: al cambiar de local no sobreviven formularios ni la clave de un gateway recién creado. */}
              <div key={place.id}>
                {tab === 'gateways' ? <Gateways l={place.id} tz={place.timezone} toast={toast.show} /> : tab === 'botones' ? <Devices l={place.id} toast={toast.show} /> : <Unknown l={place.id} tz={place.timezone} toast={toast.show} />}
              </div>
            </>
          )}
      </div>
      {toast.node}
    </Page>
  );
}
