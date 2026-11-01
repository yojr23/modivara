export { ApiRequestError, InvalidResponseError, coreApi, platformApi, toErrorState, usersApi, type ErrorState } from './client.js';
export {
  useCreateUser, useDeactivateUser, useResetPassword, useRevokeUserSessions, useSetLocationRoles, useUsers, usersKey,
} from './users.js';
export { platformOrganizationsKey, usePlatformOrganizations, useSetActingOrganization } from './platform.js';
export { isModuleEnabled, visibleLocations, visibleModules } from './navigation.js';
export { AuthProvider, useLogin, useLogout, useMe, useSession, type Session } from './session.js';
export { MODULES, loginRequestSchema } from '@modivara/core-contracts';
