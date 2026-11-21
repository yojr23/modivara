-- Conteos de control de backup.sh / restore-check.sh. Solo cuenta las tablas que existen (to_regclass): una base sin
-- Hospitality/Commerce o sin POS no falla; lo ausente simplemente no aparece (y debe ser igual en origen y restauración).
SELECT name||'='||(xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM '||tbl||where_, false, true, '')))[1]::text
FROM (VALUES
  (1, 'cuentas', 'core.app_users', ''),
  (2, 'negocios', 'core.organizations', ''),
  (3, 'planos_publicados', 'hospitality.space_layouts', ' WHERE status=''published'''),
  (4, 'llamados', 'hospitality.service_calls', ''),
  (5, 'movimientos_stock', 'commerce.stock_movements', ''),
  (6, 'ventas_pos', 'pos.sales', ''),
  (7, 'lineas_venta_pos', 'pos.sale_lines', ''),
  (8, 'outbox_pos', 'pos.outbox_events', ''),
  (9, 'audit_log', 'core.audit_log', ''),
  (10, 'articulos_pos', 'pos.sellable_items', ''),
  (11, 'ajustes_local_pos', 'pos.location_settings', ''),
  (12, 'vinculos_venta_pos', 'pos.sale_external_links', ''),
  (13, 'claves_idempotencia_pos', 'pos.idempotency_keys', '')
) v(n, name, tbl, where_)
WHERE to_regclass(tbl) IS NOT NULL
ORDER BY n;
