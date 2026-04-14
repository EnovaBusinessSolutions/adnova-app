export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/20 backdrop-blur-md border-b border-border/10">
      <div className="container mx-auto px-4 py-4">
        <div className="flex justify-end">
          <a
            href="https://adray.ai"
            title="Ir a la landing de Adnova AI"
            aria-label="Ir a la landing de Adnova AI"
            className="text-2xl font-bold animate-color-shift focus:outline-none focus:ring-2 focus:ring-primary rounded-md cursor-pointer"
          >
            Adray
          </a>
        </div>
      </div>
    </header>
  );
}
