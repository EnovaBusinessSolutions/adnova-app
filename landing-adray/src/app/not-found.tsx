import Link from "next/link";
import Container from "@/components/ui/Container";
import Button from "@/components/ui/Button";

export default function NotFound() {
    return (
        <section className="min-h-screen flex items-center justify-center relative overflow-hidden">
            <Container className="relative z-10 text-center py-20">
                <div className="text-8xl sm:text-9xl font-bold text-gradient mb-6">
                    404
                </div>
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                    Page not found
                </h1>
                <p className="text-ad-muted text-lg max-w-md mx-auto mb-10">
                    The page you&apos;re looking for doesn&apos;t exist or has been moved. Let&apos;s
                    get you back on track.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <Button variant="primary" size="lg" href="/">
                        Go Home
                    </Button>
                    <Button variant="outline" size="lg" href="/contact">
                        Contact Support
                    </Button>
                </div>
            </Container>
        </section>
    );
}
