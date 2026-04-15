
import { NavBar } from "./help-center/NavBar";
import { Footer } from "./help-center/Footer";
import { AnimatedBackground } from "./help-center/AnimatedBackground";
import { ContactInfo } from "./contact/ContactInfo";

export const ContactPage = () => {
  return (
    <div className="min-h-screen text-white font-['Montserrat'] relative">
      <AnimatedBackground />
      <div className="relative z-10">
        <NavBar />
        
        {/* Hero Section - Centered */}
        <section className="pt-24 pb-16 flex items-center justify-center min-h-[80vh]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-white via-[#E7D6FF] to-[#A259FF] bg-clip-text text-transparent">
                Contacto
              </h1>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto mb-12">
                ¿Tienes alguna pregunta o necesitas ayuda? Estamos aquí para ayudarte. 
                Contáctanos y te responderemos lo antes posible.
              </p>
            </div>
            
            {/* Contact Information - Centered */}
            <div className="flex justify-center">
              <div className="max-w-2xl w-full">
                <ContactInfo />
              </div>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </div>
  );
};
