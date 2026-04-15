import Hero from "@/components/sections/Hero";
import HighlightedText from "@/components/sections/HighlightedText";
import Steps from "@/components/sections/Steps";
import FeaturesTabs from "@/components/sections/FeaturesTabs";
import Exceptionalities from "@/components/sections/Exceptionalities";
import DataPrivacy from "@/components/sections/DataPrivacy";
import HomePricing from "@/components/sections/HomePricing";
import HomeFAQ from "@/components/sections/HomeFAQ";
import HomeIntegration from "@/components/sections/HomeIntegration";

export default function Home() {
  return (
    <>
      <Hero />
      <HighlightedText />
      <Exceptionalities />
      <FeaturesTabs />
      <Steps />
      <DataPrivacy />
      <HomePricing />
      <HomeFAQ />
      <HomeIntegration />
    </>
  );
}