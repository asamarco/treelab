

/**
 * @fileoverview
 * This file defines the Mongoose schemas and models for the application's data structures.
 * These models are used by the data-service to interact with the MongoDB database,
 * providing a structured way to create, read, update, and delete data.
 */
import mongoose, { Schema, Document, models, model } from 'mongoose';
import { TreeFile, User, GlobalSettings, TreeNode, Template } from './types';

// --- Field and Template Schemas (embedded in TreeFile) ---
const FieldSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, required: true },
  options: [String],
  columnType: String,
  height: Number,
  prefix: String,
  postfix: String,
}, { _id: false });

const ConditionalRuleSchema = new Schema({
  id: { type: String, required: true },
  fieldId: { type: String, required: true },
  operator: { type: String, required: true },
  value: { type: String }, // Value is not always required (e.g., 'is_empty')
  icon: { type: String, required: true },
  color: { type: String, required: true },
}, { _id: false });

const TemplateSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  icon: String,
  color: String,
  fields: [FieldSchema],
  nameTemplate: String,
  bodyTemplate: String,
  conditionalRules: [ConditionalRuleSchema],
}, { _id: false });

// --- GitSync Schema (embedded in TreeFile) ---
const GitSyncSchema = new Schema({
    repoOwner: { type: String, required: true },
    repoName: { type: String, required: true },
    branch: { type: String, required: true },
    lastSync: { type: String, required: true },
    lastSyncSha: String,
}, { _id: false });


// --- TreeFile Schema and Model (stores metadata, templates) ---
const TreeFileSchema = new Schema<Omit<TreeFile, 'tree'>>({
  _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
  userId: { type: String, required: true, index: true },
  sharedWith: { type: [String], default: [], index: true },
  isPublic: { type: Boolean, default: false, index: true },
  title: { type: String, required: true },
  templates: [TemplateSchema],
  expandedNodeIds: [String],
  gitSync: GitSyncSchema,
  order: { type: Number, default: 0 },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
}); 

TreeFileSchema.pre('save', function (next) {
  if (this.isNew) {
    this._id = this.id;
    this.createdAt = new Date().toISOString();
  }
  this.updatedAt = new Date().toISOString(); 
  next();
});

export const TreeModel = models.TreeFile || model<Omit<TreeFile, 'tree'>>('TreeFile', TreeFileSchema);


// --- TreeNode Schema and Model (Parent-Reference structure) ---
const TreeNodeSchema = new Schema<Omit<TreeNode, 'children'>>({
  _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
  syncId: { type: String, sparse: true, index: true }, // ID from Git, shared across different users/trees
  name: { type: String, required: true },
  templateId: { type: String, required: true },
  data: { type: String, required: true }, // Storing encrypted data as a string
  isStarred: { type: Boolean, default: false },
  userId: { type: String, required: true, index: true },
  treeId: { type: String, required: true, index: true },
  parentIds: { type: [String], default: [], index: true },
  order: { type: [Number], default: [] },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
TreeNodeSchema.pre('save', function (next) {
  if (this.isNew) {
    this._id = this.id;
  }
  next();
});
TreeNodeSchema.virtual('id').get(function() {
  return this._id;
});

export const TreeNodeModel = models.TreeNode || model<Omit<TreeNode, 'children'>>('TreeNode', TreeNodeSchema);


// --- User Schema and Model ---
const GitSettingsSchema = new Schema({
    githubPat: String,
}, { _id: false });

const UserSchema = new Schema<User>({
  _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
  username: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  salt: { type: String, required: true, select: false },
  isAdmin: { type: Boolean, default: false },
  lastActiveTreeId: String,
  theme: String,
  dateFormat: String,
  inactivityTimeoutMinutes: { type: Number, default: 15 },
  gitSettings: GitSettingsSchema,
});
UserSchema.pre('save', function (next) {
  if (this.isNew) {
    this._id = this.id;
  }
  next();
});

export const UserModel = models.User || model<User>('User', UserSchema);

// --- GlobalSettings Schema and Model ---
const GlobalSettingsSchema = new Schema<GlobalSettings>({
  allowPublicRegistration: { type: Boolean, default: true },
  customLogoPath: { type: String },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});

export const GlobalSettingsModel = models.GlobalSettings || model<GlobalSettings>('GlobalSettings', GlobalSettingsSchema);

    