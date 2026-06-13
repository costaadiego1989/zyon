import { JourneyProtocol } from "../../features/journey/JourneyProtocol.js";
import { selectJourneyProtocol } from "../../presentation/checkout-experience-model.js";

export function CheckoutStageProgress({ activeStage }: { activeStage: string }) {
  return <JourneyProtocol model={selectJourneyProtocol(activeStage)} />;
}
