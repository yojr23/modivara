import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceCall } from '../domain/service-calls/service-call.js';
import { buildWorld, seedTableWithButton, type World } from '../testing/world.js';

const T0 = new Date('2026-10-19T10:00:00Z');
let w: World;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  w = buildWorld();
});
afterEach(() => vi.useRealTimers());

describe('RegisterButtonPress', () => {
  it.each([
    ['inactivo', (w: World) => w.core.add({ id: w.ctx.locationId, organizationId: w.ctx.organizationId, timezone: 'America/Bogota', active: false })],
    ['de otro negocio', (w: World) => w.core.add({ id: w.ctx.locationId, organizationId: crypto.randomUUID(), timezone: 'America/Bogota', active: true })],
  ])('local %s: se registra el evento sin crear ni reutilizar llamado', async (_n, break_) => {
    await seedTableWithButton(w);
    break_(w);
    const out = await w.registerPress.execute(w.press());
    expect(out).toMatchObject({ result: 'unassigned_device', serviceCallId: null });
    expect(w.events.all()).toHaveLength(1);
    expect(w.calls.all()).toHaveLength(0);
    expect(w.notifications.sent).toHaveLength(0);
  });

  it('unknown_device: se registra sin más efectos', async () => {
    const out = await w.registerPress.execute(w.press({ deviceCode: 'NOPE' }));
    expect(out).toMatchObject({ result: 'unknown_device', serviceCallId: null });
    expect(w.events.all()[0]).toMatchObject({ deviceId: null, deviceCode: 'NOPE', result: 'unknown_device' });
    expect(w.calls.all()).toHaveLength(0);
    expect(w.notifications.sent).toHaveLength(0);
  });

  it('unassigned_device: botón registrado sin mesa', async () => {
    await w.registerDevice.execute({ ...w.ctx, code: 'BTN-1' });
    const out = await w.registerPress.execute(w.press());
    expect(out.result).toBe('unassigned_device');
    expect(w.calls.all()).toHaveLength(0);
  });

  it('call_created: crea la solicitud, transición, outbox y avisa después de guardar', async () => {
    const { table } = await seedTableWithButton(w, { zone: 'Terraza' });
    const out = await w.registerPress.execute(w.press());
    expect(out.result).toBe('call_created');
    const [call] = w.calls.all();
    expect(call).toMatchObject({ id: out.serviceCallId, tableId: table.id, status: 'pending', pressCount: 1 });
    expect(w.calls.transitions).toMatchObject([{ action: 'create', deviceEventId: out.deviceEventId, serviceCallId: call!.id }]);
    expect(w.calls.outbox).toHaveLength(1);
    expect(w.calls.outbox[0]).toMatchObject({ eventType: 'hospitality.service_call.created', payload: { table_label: '5', zone_name: 'Terraza' } });
    expect(w.notifications.sent).toEqual([{ change: 'created', callId: call!.id, persistedStatus: 'pending' }]);
  });

  it('receivedAt viene del reloj del servidor; sentAt solo se conserva', async () => {
    await seedTableWithButton(w);
    const sentAt = new Date('2020-01-01T00:00:00Z');
    await w.registerPress.execute(w.press({ sentAt }));
    expect(w.events.all()[0]).toMatchObject({ receivedAt: T0, sentAt });
  });

  it('repeat_press (>= 3 s): suma pressCount sin crear transición ni evento', async () => {
    await seedTableWithButton(w);
    await w.registerPress.execute(w.press());
    vi.setSystemTime(new Date(T0.getTime() + 3_000));
    const out = await w.registerPress.execute(w.press());
    expect(out.result).toBe('repeat_press');
    expect(w.calls.all()).toHaveLength(1);
    expect(w.calls.all()[0]).toMatchObject({ pressCount: 2, lastPressAt: new Date(T0.getTime() + 3_000) });
    expect(w.calls.outbox).toHaveLength(1);
    expect(w.calls.transitions).toHaveLength(1);
    expect(w.notifications.sent.map((n) => n.change)).toEqual(['created', 'repeat_press']);
  });

  it('debounced (< 3 s): no suma ni avisa, y la ventana se mide desde la última pulsación contada', async () => {
    await seedTableWithButton(w);
    await w.registerPress.execute(w.press());
    vi.setSystemTime(new Date(T0.getTime() + 2_000));
    expect((await w.registerPress.execute(w.press())).result).toBe('debounced');
    expect(w.calls.all()[0]!.pressCount).toBe(1);
    vi.setSystemTime(new Date(T0.getTime() + 4_000)); // 4 s desde la contada, aunque 2 s desde la descartada
    expect((await w.registerPress.execute(w.press())).result).toBe('repeat_press');
    expect(w.notifications.sent).toHaveLength(2);
  });

  it('teclas distintas del mismo botón no se descartan entre sí', async () => {
    await seedTableWithButton(w);
    await w.registerPress.execute(w.press({ buttonKey: 'A' }));
    const out = await w.registerPress.execute(w.press({ buttonKey: 'B' }));
    expect(out.result).toBe('repeat_press');
  });

  it('nueva pulsación tras completed crea un llamado nuevo', async () => {
    await seedTableWithButton(w);
    const first = await w.registerPress.execute(w.press());
    await w.acknowledge.execute({ ...w.ctx, callId: first.serviceCallId! });
    await w.complete.execute({ ...w.ctx, callId: first.serviceCallId! });
    vi.setSystemTime(new Date(T0.getTime() + 10_000));
    const second = await w.registerPress.execute(w.press());
    expect(second.result).toBe('call_created');
    expect(second.serviceCallId).not.toBe(first.serviceCallId);
    expect(w.calls.all()).toHaveLength(2);
  });

  it('pulsación con la solicitud en in_progress suma a la misma', async () => {
    await seedTableWithButton(w);
    const first = await w.registerPress.execute(w.press());
    await w.acknowledge.execute({ ...w.ctx, callId: first.serviceCallId! });
    vi.setSystemTime(new Date(T0.getTime() + 10_000));
    const out = await w.registerPress.execute(w.press());
    expect(out).toMatchObject({ result: 'repeat_press', serviceCallId: first.serviceCallId });
  });

  it('dos botones de la misma mesa comparten la solicitud activa', async () => {
    const { table } = await seedTableWithButton(w);
    const second = await w.registerDevice.execute({ ...w.ctx, code: 'BTN-2' });
    await w.assignDevice.execute({ ...w.ctx, deviceId: second.id, tableId: table.id });
    await w.registerPress.execute(w.press());
    const out = await w.registerPress.execute(w.press({ deviceCode: 'BTN-2' }));
    expect(out.result).toBe('repeat_press');
    expect(w.calls.all()).toHaveLength(1);
  });

  it('un botón desasignado vuelve a unassigned_device', async () => {
    const { device } = await seedTableWithButton(w);
    await w.unassignDevice.execute({ ...w.ctx, deviceId: device.id });
    expect((await w.registerPress.execute(w.press())).result).toBe('unassigned_device');
  });

  it('aislamiento por local: el código de otro local es desconocido', async () => {
    await seedTableWithButton(w);
    const out = await w.registerPress.execute(w.press({ locationId: crypto.randomUUID() }));
    expect(out.result).toBe('unknown_device');
  });

  it('si el aviso falla, la pulsación igual queda guardada', async () => {
    await seedTableWithButton(w);
    w.notifications.fail = true;
    expect((await w.registerPress.execute(w.press())).result).toBe('call_created');
    expect(w.calls.all()).toHaveLength(1);
  });

  it('conflicto al crear (otra señal creó la solicitud antes): reintenta y suma', async () => {
    const { table } = await seedTableWithButton(w);
    let injected = false;
    w.calls.beforeSave = async (call) => {
      if (injected || call.persistedStatus !== null) return;
      injected = true;
      // Otra señal ganó la carrera: guarda su propia solicitud para la misma mesa.
      const rival = ServiceCall.create({
        organizationId: w.ctx.organizationId, locationId: w.ctx.locationId,
        table: { id: table.id, label: '5', zoneId: null, zoneName: null },
        callType: 'attention', deviceEventId: crypto.randomUUID(), correlationId: crypto.randomUUID(), now: new Date(),
      });
      w.calls.beforeSave = undefined;
      await w.calls.save(rival);
    };
    const out = await w.registerPress.execute(w.press());
    expect(out.result).toBe('repeat_press');
    expect(w.calls.all()).toHaveLength(1);
    expect(w.calls.all()[0]!.pressCount).toBe(2);
  });
});
