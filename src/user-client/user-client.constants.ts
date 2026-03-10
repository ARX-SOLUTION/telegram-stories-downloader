export const USER_CLIENT_API_BASE_PATH = '/api/user-client';

export const USER_CLIENT_API_ROUTES = {
  dialogs: `${USER_CLIENT_API_BASE_PATH}/dialogs`,
  status: `${USER_CLIENT_API_BASE_PATH}/status`,
  initiateLogin: `${USER_CLIENT_API_BASE_PATH}/login/initiate`,
  submitCode: `${USER_CLIENT_API_BASE_PATH}/login/submit-code`,
  submitPhone: `${USER_CLIENT_API_BASE_PATH}/login/submit-phone`,
  submitPassword: `${USER_CLIENT_API_BASE_PATH}/login/submit-password`,
} as const;
