import Container from "@/components/ui/Container";

export const metadata = {
    title: "Terms of Service",
};

const TERMLY_TERMS_URL =
    "https://app.termly.io/policy-viewer/policy.html?policyUUID=2020c20e-abe7-4fd2-bebb-7ad0d29c5d3b";

export default function TermsOfServicePage() {
    return (
        <section className="pt-32 pb-24">
            <Container>
                <h1 className="t-h2 text-white-95 mb-4">Terms of Service</h1>
                <p className="t-p text-white-80 mb-8">
                    These terms are embedded directly from Termly.
                </p>

                <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <iframe
                        title="Terms of Service"
                        src={TERMLY_TERMS_URL}
                        className="w-full min-h-[70vh]"
                        loading="lazy"
                    />
                </div>
            </Container>
        </section>
    );
}
