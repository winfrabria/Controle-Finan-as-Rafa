-- Keep the event trigger available to PostgreSQL while preventing application
-- roles from invoking its SECURITY DEFINER function directly.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM service_role;

