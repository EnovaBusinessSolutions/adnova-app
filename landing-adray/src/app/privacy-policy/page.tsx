import Container from "@/components/ui/Container";

export const metadata = {
    title: "Privacy Policy",
};

export default function PrivacyPolicyPage() {
    return (
        <section className="pt-32 pb-24">
            <Container>
                <h1 className="t-h2 text-white-95 mb-4">Privacy Policy</h1>
                <p className="t-p text-white-80 mb-2">
                    Last updated: March 25, 2026
                </p>
                <p className="t-p text-white-80 mb-8">
                    This Privacy Notice for Adray, Inc. (doing business as
                    Adray) (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;)
                    explains how and why we may access, collect, store, use,
                    and/or share (&quot;process&quot;) your personal
                    information when you use our services (&quot;Services&quot;).
                </p>

                <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-6 md:p-10 space-y-8 text-white-90">
                    <div className="space-y-3">
                        <h2 className="t-h4 text-white-95">
                            Summary of Key Points
                        </h2>
                        <p className="t-p text-white-80">
                            We may process personal information depending on how
                            you interact with our Services, the choices you
                            make, and the products and features you use. We do
                            not process sensitive personal information. We may
                            process your information to provide, improve, and
                            secure our Services, communicate with you, prevent
                            fraud, and comply with legal obligations.
                        </p>
                        <p className="t-p text-white-80">
                            Depending on where you live, you may have privacy
                            rights (such as access, correction, deletion, and
                            objection). To exercise your rights, contact{" "}
                            <a
                                href="mailto:privacy@adray.ai"
                                className="underline"
                            >
                                privacy@adray.ai
                            </a>
                            .
                        </p>
                    </div>

                    <div className="space-y-3">
                        <h2 className="t-h4 text-white-95">Table of Contents</h2>
                        <ol className="list-decimal pl-5 space-y-1 t-p text-white-80">
                            <li>What information do we collect?</li>
                            <li>How do we process your information?</li>
                            <li>
                                What legal bases do we rely on to process your
                                personal information?
                            </li>
                            <li>
                                When and with whom do we share your personal
                                information?
                            </li>
                            <li>
                                Do we use cookies and other tracking
                                technologies?
                            </li>
                            <li>
                                Do we offer products based on artificial
                                intelligence?
                            </li>
                            <li>How do we handle social logins?</li>
                            <li>How long do we keep your information?</li>
                            <li>How do we keep your information safe?</li>
                            <li>Do we collect information from minors?</li>
                            <li>What are your privacy rights?</li>
                            <li>Controls for Do-Not-Track features.</li>
                            <li>
                                Do United States residents have specific privacy
                                rights?
                            </li>
                            <li>
                                Do other regions have specific privacy rights?
                            </li>
                            <li>Do we make updates to this notice?</li>
                            <li>How can you contact us about this notice?</li>
                            <li>
                                How can you review, update, or delete the data
                                we collect from you?
                            </li>
                        </ol>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            1) What Information Do We Collect?
                        </h2>
                        <p className="t-p text-white-80">
                            We collect personal information that you voluntarily
                            provide when you register, request information, use
                            features in our Services, or contact us.
                        </p>
                        <p className="t-p text-white-80">
                            Depending on your use case, this may include: name,
                            phone number, email address, postal address,
                            username, password, billing information, and payment
                            details. Payment data is processed by Stripe (see{" "}
                            <a
                                href="https://stripe.com/en-mx/privacy"
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                            >
                                Stripe Privacy Policy
                            </a>
                            ).
                        </p>
                        <p className="t-p text-white-80">
                            We may also collect app-related data such as
                            geolocation (if permitted), push notification
                            preferences, login activity, device information, and
                            usage logs. We may collect social login profile data
                            if you sign in with a third-party account.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            2) How Do We Process Your Information?
                        </h2>
                        <p className="t-p text-white-80">
                            We process your information to operate and improve
                            our Services, manage accounts, provide support, send
                            administrative notices, detect fraud, analyze usage,
                            and deliver marketing (where lawful).
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            3) Legal Bases for Processing
                        </h2>
                        <p className="t-p text-white-80">
                            Where required by law, we process personal
                            information under one or more legal bases, including
                            consent, contract performance, legal obligations,
                            legitimate interests, and vital interests.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            4) When and With Whom We Share Information
                        </h2>
                        <p className="t-p text-white-80">
                            We may share information with service providers and
                            in business transfer scenarios (for example, merger,
                            acquisition, financing, or sale of assets).
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            5) Cookies and Tracking Technologies
                        </h2>
                        <p className="t-p text-white-80">
                            We use cookies and similar technologies for security,
                            analytics, functionality, and communications. See
                            our Cookie Notice at{" "}
                            <a
                                href="http://www.adray.ai/cookies"
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                            >
                                http://www.adray.ai/cookies
                            </a>
                            .
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            6) AI-Based Products
                        </h2>
                        <p className="t-p text-white-80">
                            We provide AI-enabled features and may use trusted
                            AI service providers such as Google Cloud AI, AWS
                            AI, Anthropic, ElevenLabs, and OpenAI to support
                            those functions.
                        </p>
                        <p className="t-p text-white-80">
                            AI functionality may include data normalization,
                            analysis, search, automation, predictive analytics,
                            image/video generation, translation, and document
                            generation.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            7) Social Login
                        </h2>
                        <p className="t-p text-white-80">
                            If you sign in with social providers (such as
                            Facebook or X), we may receive profile information
                            based on your social account settings and granted
                            permissions.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            8) Data Retention
                        </h2>
                        <p className="t-p text-white-80">
                            We retain personal information only as long as
                            necessary for the purposes described in this notice,
                            unless a longer retention period is required by law.
                            In general, we do not keep personal data for more
                            than three (3) months after account closure unless
                            legally required.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            9) Security Measures
                        </h2>
                        <p className="t-p text-white-80">
                            We implement technical and organizational safeguards
                            to protect personal information. However, no online
                            transmission or storage method is fully secure.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            10) Information from Minors
                        </h2>
                        <p className="t-p text-white-80">
                            We do not knowingly collect or market to children
                            under 18 (or equivalent age in your jurisdiction).
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            11) Your Privacy Rights
                        </h2>
                        <p className="t-p text-white-80">
                            Depending on applicable law, you may have rights to
                            access, correct, delete, restrict, or object to
                            processing of your personal information, and to data
                            portability.
                        </p>
                        <p className="t-p text-white-80">
                            To exercise your rights, contact{" "}
                            <a
                                href="mailto:privacy@adray.ai"
                                className="underline"
                            >
                                privacy@adray.ai
                            </a>
                            .
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            12) Do-Not-Track
                        </h2>
                        <p className="t-p text-white-80">
                            Because no uniform standard for DNT is finalized, we
                            currently do not respond to browser DNT signals.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            13) U.S. State Privacy Rights
                        </h2>
                        <p className="t-p text-white-80">
                            Residents of certain U.S. states may have specific
                            rights under applicable privacy laws, including
                            rights to know, access, correct, delete, opt out of
                            targeted advertising/sale/profiling, and appeal.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            14) Other Regional Rights
                        </h2>
                        <p className="t-p text-white-80">
                            Users in regions such as the EEA, UK, Switzerland,
                            Canada, Australia, New Zealand, and South Africa may
                            have additional rights under local law.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            15) Updates to This Notice
                        </h2>
                        <p className="t-p text-white-80">
                            We may update this Privacy Policy periodically. The
                            revised version will show an updated effective date.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            16) Contact Information
                        </h2>
                        <p className="t-p text-white-80">
                            Email:{" "}
                            <a
                                href="mailto:contact@adray.ai"
                                className="underline"
                            >
                                contact@adray.ai
                            </a>
                        </p>
                        <p className="t-p text-white-80">
                            Adray, Inc.
                            <br />
                            1111B S Governors Ave # 53849
                            <br />
                            Dover, DE 19904
                            <br />
                            United States
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            17) Data Access, Update, and Deletion Requests
                        </h2>
                        <p className="t-p text-white-80">
                            To review, update, or delete your personal
                            information, please submit a data subject access
                            request by contacting us at{" "}
                            <a
                                href="mailto:privacy@adray.ai"
                                className="underline"
                            >
                                privacy@adray.ai
                            </a>
                            .
                        </p>
                    </div>
                </div>
            </Container>
        </section>
    );
}
