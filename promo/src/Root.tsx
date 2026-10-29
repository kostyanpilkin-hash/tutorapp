import { Composition } from "remotion";
import { Promo } from "./Promo";

export const Root = () => {
  return (
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={1200}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
