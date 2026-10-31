import { LOCATION_ROLES, passwordSchema, usernameSchema, USERNAME_MAX, USERNAME_MIN, type LocationRole, type UserResponse } from '@modivara/core-contracts';
import {
  ApiRequestError, useCreateUser, useDeactivateUser, useResetPassword, useRevokeUserSessions, useSetLocationRoles, useUsers,
} from '@modivara/core-web';
import { ChevronDown, Users as UsersIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { Bone, EmptyState, ErrorState, Page, useApp, useToast } from './ui';

// F1-15 — usuarios del negocio. Permiso: `core.users.manage` en el local (sin módulo: es de core).
// La API no devuelve las membresías en el listado: los roles se ven al elegir un local y se fijan con «Guardar roles».
// OPEN: ¿exponer roles por local en `GET /users` para mostrarlos en la lista?

const ROLE_LABEL: Record<LocationRole, string> = { admin: 'Administrador', staff: 'Personal', inventory: 'Inventario' };
const PASSWORD_RULES = `Entre 8 y 128 caracteres, con al menos una mayúscula y un número.`;
const USERNAME_RULES = `De ${USERNAME_MIN} a ${USERNAME_MAX} caracteres: minúsculas, números, punto, guion y guion bajo.`;
const field = 'mt-1 block h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-sm text-fg';

const BY_CODE: Record<string, string> = {
  conflict: 'Ya existe un usuario con ese nombre de usuario en el negocio.',
  permission_denied: 'No tienes permiso para gestionar a este usuario o este local.',
  not_found: 'Ya no existe (o no puedes verlo). Recarga la página.',
  location_unavailable: 'El local ya no está disponible.',
  weak_password: `La clave no cumple las reglas. ${PASSWORD_RULES}`,
  validation: 'Hay datos que el servidor no aceptó. Revísalos.',
  session_invalid: 'Tu sesión venció. Entra de nuevo.',
};
const say = (e: unknown, fallback: string) => (e instanceof ApiRequestError && BY_CODE[e.code]) || fallback;

function Roles({ value, onChange }: { value: LocationRole[]; onChange: (r: LocationRole[]) => void }) {
  return (
    <fieldset className="text-sm">
      <legend className="text-muted">Roles en el local</legend>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {LOCATION_ROLES.map((r) => (
          <label key={r} className="flex min-h-10 items-center gap-2">
            <input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
            {ROLE_LABEL[r]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** `<dialog>` nativo: Escape y foco los maneja el navegador. */
function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog ref={ref} aria-label={label} onClose={onClose} className="m-auto w-full max-w-md rounded-lg border border-line bg-surface p-6 text-fg shadow-xl backdrop:bg-ink/40">
      {children}
    </dialog>
  );
}

function CreateUser({ onClose, onDone, onWarn }: { onClose: () => void; onDone: (text: string) => void; onWarn: (text: string) => void }) {
  const { me } = useApp();
  const places = me.locations.filter((l) => l.permissions.includes('core.users.manage'));
  const create = useCreateUser();
  const setRoles = useSetLocationRoles();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [locationId, setLocationId] = useState(places[0]?.id ?? '');
  const [roles, setR] = useState<LocationRole[]>(['staff']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const u = usernameSchema.safeParse(username);
    if (!name.trim() || name.trim().length > 100) return setError('Escribe el nombre visible (hasta 100 caracteres).');
    if (!u.success) return setError(USERNAME_RULES);
    if (!passwordSchema.safeParse(password).success) return setError(`Clave inicial no válida. ${PASSWORD_RULES}`);
    if (!locationId) return setError('Elige el local del usuario.');
    if (roles.length === 0) return setError('Elige al menos un rol.');
    setBusy(true);
    setError('');
    let created: UserResponse;
    try {
      created = await create.mutateAsync({ username: u.data, display_name: name.trim(), password });
    } catch (err) {
      setBusy(false);
      return setError(say(err, 'No se pudo crear el usuario. Intenta de nuevo.'));
    }
    try {
      await setRoles.mutateAsync({ userId: created.id, locationId, input: { roles } });
    } catch (err) {
      // Paso 2 fallido: el usuario existe sin local. Se avisa y el panel de la lista permite asignarlo.
      onWarn(`El usuario «${created.username}» se creó, pero NO se le pudieron asignar los roles (${say(err, 'error desconocido')}). Ábrelo en la lista y asígnale local y roles.`);
      return onClose();
    }
    onDone(`Usuario «${created.username}» creado.`);
    onClose();
  }

  return (
    <Modal label="Nuevo usuario" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <h2 className="text-lg font-bold">Nuevo usuario</h2>
        <label className="block text-sm text-muted">Nombre visible<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="off" className={field} /></label>
        <label className="block text-sm text-muted">Usuario<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" autoCapitalize="none" className={field} /></label>
        <p className="-mt-2 text-xs text-muted">{USERNAME_RULES}</p>
        <label className="block text-sm text-muted">Clave inicial<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={field} /></label>
        <p className="-mt-2 text-xs text-muted">{PASSWORD_RULES}</p>
        <label className="block text-sm text-muted">Local
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={field}>
            {places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <Roles value={roles} onChange={setR} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear usuario'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDeactivate({ user, onClose, onDone }: { user: UserResponse; onClose: () => void; onDone: () => void }) {
  const deactivate = useDeactivateUser();
  const [error, setError] = useState('');
  async function go() {
    setError('');
    try {
      await deactivate.mutateAsync(user.id);
      onDone();
    } catch (e) {
      setError(say(e, 'No se pudo desactivar. Intenta de nuevo.'));
    }
  }
  return (
    <Modal label={`Desactivar a ${user.display_name}`} onClose={onClose}>
      <h2 className="mb-2 text-lg font-bold">Desactivar a {user.display_name}</h2>
      <p className="mb-4 text-sm text-muted">Ya no podrá entrar y se cerrarán sus sesiones abiertas. Sus registros pasados se conservan.</p>
      {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" autoFocus onClick={onClose}>Cancelar</Button>
        <Button size="sm" variant="secondary" className="text-danger" disabled={deactivate.isPending} onClick={go}>Desactivar</Button>
      </div>
    </Modal>
  );
}

function UserPanel({ user, self, onMsg }: { user: UserResponse; self: boolean; onMsg: (t: string) => void }) {
  const { me } = useApp();
  const places = me.locations.filter((l) => l.permissions.includes('core.users.manage'));
  const setRoles = useSetLocationRoles();
  const reset = useResetPassword();
  const revoke = useRevokeUserSessions();
  const [locationId, setLocationId] = useState(places[0]?.id ?? '');
  const [roles, setR] = useState<LocationRole[]>([]);
  const [newPass, setNewPass] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string, fail: string) {
    setError('');
    try {
      await fn();
      onMsg(ok);
    } catch (e) {
      setError(say(e, fail));
    }
  }
  const saveRoles = () => roles.length === 0 ? setError('Elige al menos un rol.') : run(() => setRoles.mutateAsync({ userId: user.id, locationId, input: { roles } }), 'Roles guardados.', 'No se pudieron guardar los roles.');
  const resetPass = async () => {
    if (!passwordSchema.safeParse(newPass).success) return setError(`Clave no válida. ${PASSWORD_RULES}`);
    await run(() => reset.mutateAsync({ userId: user.id, input: { new_password: newPass } }), 'Clave restablecida. Se cerraron sus sesiones; comparte la nueva clave por un canal seguro.', 'No se pudo restablecer la clave.');
    setNewPass('');
  };

  return (
    <div className="space-y-5 border-t border-line p-3 text-sm md:p-4">
      <section aria-label="Roles" className="space-y-3">
        <h3 className="font-semibold">Roles por local</h3>
        <label className="block max-w-xs text-muted">Local
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={field}>
            {places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <Roles value={roles} onChange={setR} />
        <Button size="sm" variant="secondary" disabled={setRoles.isPending} onClick={saveRoles}>Guardar roles</Button>
      </section>
      <section aria-label="Clave" className="space-y-2">
        <h3 className="font-semibold">Restablecer clave</h3>
        <label className="block max-w-xs text-muted">Clave nueva<input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" className={field} /></label>
        <p className="text-xs text-muted">{PASSWORD_RULES}</p>
        <Button size="sm" variant="secondary" disabled={reset.isPending} onClick={resetPass}>Restablecer clave</Button>
      </section>
      <section aria-label="Sesiones y estado" className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button size="sm" variant="secondary" disabled={revoke.isPending} onClick={() => run(() => revoke.mutateAsync(user.id), 'Sesiones cerradas.', 'No se pudieron cerrar las sesiones.')}>Cerrar sesiones</Button>
        {self ? <p className="self-center text-muted">No puedes desactivarte a ti mismo.</p>
          : <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirm(true)}>Desactivar usuario</Button>}
      </section>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {confirm && <ConfirmDeactivate user={user} onClose={() => setConfirm(false)} onDone={() => { setConfirm(false); onMsg(`«${user.username}» desactivado.`); }} />}
    </div>
  );
}

export default function Users() {
  const { me } = useApp();
  const q = useUsers();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [warn, setWarn] = useState('');
  const term = search.trim().toLowerCase();
  const users = (q.data ?? []).filter((u) => !term || u.display_name.toLowerCase().includes(term) || u.username.includes(term));

  return (
    <Page id="usuarios" title="Usuarios" subtitle="Personas con acceso al negocio" actions={<Button className="ml-auto" onClick={() => setCreating(true)}>Nuevo usuario</Button>}>
      <div className="space-y-4 p-4 md:p-6">
        <label className="block max-w-sm text-sm text-muted">Buscar
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o usuario" className={field} />
        </label>
        {warn && <p role="alert" className="flex items-start gap-3 rounded-md border border-danger/40 bg-surface p-3 text-sm">{warn}<button type="button" className="ml-auto underline" onClick={() => setWarn('')}>Cerrar aviso</button></p>}
        {q.isPending ? <div role="status" aria-label="Cargando usuarios" className="space-y-4">{Array.from({ length: 5 }, (_, i) => <Bone key={i} className="h-12 w-full" />)}</div>
          : q.isError ? <ErrorState what="los usuarios" onRetry={() => void q.refetch()} />
          : users.length === 0 ? <EmptyState Icon={UsersIcon} title={term ? 'Nadie coincide' : 'Aún no hay usuarios'} text={term ? 'Prueba con otro nombre o usuario.' : 'Crea el primero con «Nuevo usuario».'} />
          : (
            <ul className="space-y-2">
              {users.map((u) => {
                const expanded = open === u.id;
                return (
                  <li key={u.id} className="rounded-lg border border-line bg-surface">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
                      <span className="min-w-0 flex-1 basis-48"><b className="block truncate font-semibold">{u.display_name}</b><span className="text-muted">{u.username}</span></span>
                      <span className="text-muted">{u.is_owner ? 'Dueño' : 'Usuario'}</span>
                      <span className={u.active ? 'font-semibold' : 'font-semibold text-muted'}>{u.active ? 'Activo' : 'Desactivado'}</span>
                      <Button size="sm" variant="secondary" aria-expanded={expanded} aria-label={`Gestionar ${u.display_name}`} onClick={() => setOpen(expanded ? null : u.id)}>
                        Gestionar<ChevronDown aria-hidden className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </Button>
                    </div>
                    {expanded && <UserPanel user={u} self={u.id === me.actor.user_id} onMsg={toast.show} />}
                  </li>
                );
              })}
            </ul>
          )}
      </div>
      {creating && <CreateUser onClose={() => setCreating(false)} onDone={toast.show} onWarn={setWarn} />}
      {toast.node}
    </Page>
  );
}
