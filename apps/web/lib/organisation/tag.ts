import type { TagColor } from "./rules";

/** A tag of the library's one list, as the screens read it: its marker is the colour name they draw. */
export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}
