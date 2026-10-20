// Claves de metadato que leen los guards globales de core. Strings sin dependencias de Nest: cada dominio define su
// decorador con `SetMetadata(<clave>, valor)` sin importar internos de core-api (ADR-002 D1).

/** `true` en un handler o controlador: no exige sesión (login, health, gateways con su propia clave). */
export const IS_PUBLIC_KEY = 'modivara:public';
/** Valor: un `Permission`. El actor debe tenerlo (en el local de la ruta, o en cualquiera si la ruta no lleva `:locationId`). */
export const REQUIRED_PERMISSION_KEY = 'modivara:permission';
/** Valor: un `ModuleName`. El negocio del actor debe tenerlo habilitado (entitlement). */
export const REQUIRED_MODULE_KEY = 'modivara:module';
/** Propiedad de la petición donde `SessionGuard` deja el contexto del actor ya autenticado. */
export const REQUEST_ACTOR_KEY = 'actor';
/** Parámetro de ruta que identifica el local en las rutas por local. */
export const LOCATION_ID_PARAM = 'locationId';
