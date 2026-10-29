import PulseWorkspace from "../../workspace/PulseWorkspace";

type Props = { v: any };

/* Home: the Pulse workspace. A particle presence and the command bar; views
   open from what you ask. See src/workspace. */
export default function Home(_props: Props) {
  return <PulseWorkspace />;
}
