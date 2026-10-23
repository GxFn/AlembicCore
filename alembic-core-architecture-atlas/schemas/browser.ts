import type { BookIndex, JourneyBacklink, SearchEntry } from './book.ts';
import type { AtlasDocument, Graph, SourceFile } from './model.ts';
export interface AssetRef {
  url: string;
  kind: string;
  identity: string;
  sha256: string;
  bytes: number;
}
export interface TopicCard {
  id: string;
  title: string;
  question: string;
  ownedFileCount: number;
  reviewDepth: string;
  path: string | null;
}
export interface AtlasBootstrap {
  schemaVersion: 1;
  kind: 'core-atlas-bootstrap';
  summary: typeof import('../data/validation-summary.json');
  review: typeof import('../data/review-summary.json');
  topics: TopicCard[];
  assets: Record<string, AssetRef>;
}
export interface TopicAsset {
  navigation: {
    links: Record<string, { title: string; href: string }>;
    backlinks: Record<string, JourneyBacklink[]>;
  };
  document: AtlasDocument;
  dependency: Graph | null;
}
export interface FileAsset {
  files: SourceFile[];
}
export interface SearchAsset {
  entries: SearchEntry[];
  documents: Array<{
    topicId: string;
    title: string;
    question: string;
    truthKind: string;
    text: string;
  }>;
  files: Array<{ path: string; topicId: string | null; symbols: string[]; publicNames: string[] }>;
}
export interface ApiAsset {
  journeys?: Array<{ id: string; title: string; entryApis: string[] }>;
  policyPath: string;
  entries: Array<{
    name: string;
    policy: string;
    modules: Array<{
      path: string;
      exports: Array<{ name: string; kind: string; origin: string | null; declaredName: string }>;
    }>;
  }>;
}
export interface ImpactAsset {
  book?: BookIndex | null;
  inputs: Array<{ topicId: string; title: string; paths: string[] }>;
  files: Array<{ path: string; category: string }>;
  edges: Array<{ from: string; to: string | null; kind: string }>;
  unknownCount: number;
}
