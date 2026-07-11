export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button className={className} type="submit">
        Sair
      </button>
    </form>
  );
}
