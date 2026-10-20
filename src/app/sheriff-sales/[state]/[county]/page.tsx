import StateCountyPage, { generateMetadata as stateCountyMetadata } from "@/app/states/[state]/[county]/page";

export const dynamic = "force-dynamic";
export const generateMetadata = stateCountyMetadata;
export default StateCountyPage;
