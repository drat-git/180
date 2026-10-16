// Enable only after an email sender and recovery redirects are configured.
export const passwordRecoveryEnabled =
  import.meta.env.VITE_PASSWORD_RECOVERY_ENABLED === "true";
