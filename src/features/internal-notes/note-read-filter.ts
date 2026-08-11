export type NoteReadMode = "read" | "unread";

export function buildNoteReadFilter(
  profileId: string | undefined,
  readMode: NoteReadMode | undefined,
) {
  if (readMode === "read") {
    return {
      noteReads: {
        some: profileId ? { profileId } : {},
      },
    };
  }

  if (readMode === "unread" && profileId) {
    return {
      noteReads: {
        none: { profileId },
      },
    };
  }

  return {};
}
