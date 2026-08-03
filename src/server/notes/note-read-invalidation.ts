export type NoteReadInvalidationTransaction = {
  noteRead: {
    deleteMany(input: { where: { noteId: string } }): Promise<unknown>;
  };
};

/**
 * Must receive the caller's transaction delegate so a new diagnosis and the
 * read reset commit atomically.
 */
export function invalidateNoteReads(
  transaction: NoteReadInvalidationTransaction,
  noteId: string,
) {
  return transaction.noteRead.deleteMany({ where: { noteId } });
}
