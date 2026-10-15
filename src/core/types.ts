export interface RenameResult {
  type: 'file' | 'directory';
  oldPath: string;
  newPath: string;
  status: 'renamed' | 'noop-same-inode' | 'collision' | 'skipped';
}
