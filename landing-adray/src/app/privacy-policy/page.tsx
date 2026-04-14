import Container from "@/components/ui/Container";

export const metadata = {
    title: "Privacy Policy",
};

const TERMLY_POLICY_URL =
    "https://app.termly.io/policy-viewer/policy.html?policyUUID=056ebd3b-2cd8-4a29-bd36-640842dc8a05";

export default function PrivacyPolicyPage() {
    return (
        <section className="pt-32 pb-24">
            <Container>
                <h1 className="t-h2 text-white-95 mb-4">Privacy Policy</h1>
                <p className="t-p text-white-80 mb-8">
                    This policy is embedded directly from Termly.
                </p>

                <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <iframe
                        title="Privacy Policy"
                        src={TERMLY_POLICY_URL}
                        className="w-full min-h-[70vh]"
                        loading="lazy"
                    />
                </div>
            </Container>
        </section>
    );
}
