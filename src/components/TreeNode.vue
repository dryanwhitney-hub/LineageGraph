<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';

interface ProbandData { henry_code: string; generation: number; }
interface SpouseConnection { id: string; date: string | null; place: string | null; divorce_date: string | null; is_divorced: boolean; }
interface RelationInfo { type: 'spouse' | 'parent'; date?: string | null; place?: string | null; is_divorced?: boolean; divorce_date?: string | null; }

interface Person {
  id: string; 
  given_name: string | null; 
  surname: string | null; 
  sex: string | null;
  birth_date: string | null; 
  birth_place: string | null; 
  death_date: string | null; 
  death_place: string | null;
  proband_data: Record<string, ProbandData>; 
  gedcom_extra: Record<string, any>;
  spouses: SpouseConnection[]; 
  parent_ids: string[];
}

interface TreeNodeData {
  person: Person; 
  active_henry: string; 
  active_gen: number; 
  children: TreeNodeData[];
  spouse_nodes: TreeNodeData[]; 
  parent_nodes: TreeNodeData[];
  is_side_branch: boolean; 
  side_branch_type: 'spouse' | 'parent' | null; 
  relation_info: RelationInfo | null;
}

const props = defineProps<{
  node: TreeNodeData;
  selectedId: string;
  expandedNodes: Map<string, boolean>;
  expandedSideNodes: Map<string, { spouses: boolean, parents: boolean }>;
  isRoot?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', person: Person): void;
  (e: 'toggle', personId: string): void;
  (e: 'toggle-side', personId: string, type: 'spouses' | 'parents'): void;
  (e: 'load-parent', node: TreeNodeData): void;
  (e: 'jump-to', personId: string): void;
}>();
</script>

<template>
  <li :class="{ 'is-side-branch-node': node.is_side_branch, 'is-spouse-node': node.side_branch_type === 'spouse', 'is-parent-node': node.side_branch_type === 'parent' }">
    
    <!-- Rote Info-Box für die Ehedaten auf der Verbindungslinie -->
    <div v-if="node.side_branch_type === 'spouse' && (node.relation_info?.date || node.relation_info?.place || node.relation_info?.is_divorced || node.person.death_date)" class="marriage-label">
      <template v-if="node.relation_info?.date || node.relation_info?.place">
        <span class="mar-data">verh. {{ node.relation_info?.date || '' }} {{ node.relation_info?.place || '' }}</span>
      </template>
      <template v-if="node.relation_info?.is_divorced">
        <br><span class="mar-divorced">gesch. {{ node.relation_info?.divorce_date || '' }}</span>
      </template>
      <template v-else-if="node.person.death_date">
        <br><span class="mar-death">† {{ node.person.death_date }}</span>
      </template>
    </div>

    <div class="node-cluster">
      
      <!-- 1. ELTERN (Vertikal über der Hauptbox) -->
      <ul class="cluster-parents side-list" v-if="node.parent_nodes && node.parent_nodes.length > 0">
        <TreeNode 
          v-for="p in node.parent_nodes" :key="'p-'+p.person.id" :node="p" :selected-id="selectedId"
          :expanded-nodes="expandedNodes" :expanded-side-nodes="expandedSideNodes"
          @select="p => emit('select', p)" @toggle="id => emit('toggle', id)"
          @toggle-side="(id, type) => emit('toggle-side', id, type)" @load-parent="n => emit('load-parent', n)"
          @jump-to="id => emit('jump-to', id)"
        />
      </ul>

      <!-- 2. HAUPTKNOTEN & EHEPARTNER (Horizontal nebeneinander) -->
      <div class="cluster-main-row">
        
        <div class="node-card" :class="{ 'active': selectedId === node.person.id, 'side-branch-card': node.is_side_branch }" @click.stop="emit('select', node.person)">
          <button v-if="isRoot && (node.active_henry.length > 1 || node.person.parent_ids.length > 0)" class="expand-btn expand-parent-btn" @click.stop="emit('load-parent', node)" title="Elterngeneration laden">🔼</button>
          
          <div class="node-header">
            <strong>{{ node.person.surname || 'N.N.' }}, {{ node.person.given_name || 'N.N.' }}</strong>
            <span 
              class="badge" 
              :class="{ 'clickable-badge': node.is_side_branch }"
              @click.stop="node.is_side_branch ? emit('jump-to', node.person.id) : null"
              :title="node.is_side_branch ? 'Zu diesem Ast springen' : ''"
              v-if="node.active_henry"
            >
              [{{ node.active_henry }}]
            </span>
          </div>
          <div class="dates">(* {{ node.person.birth_date || '?' }}<span v-if="node.person.death_date"> - † {{ node.person.death_date }}</span>)</div>
          
          <div class="side-actions" v-if="!node.is_side_branch">
            <button v-if="node.person.spouses.length > 0" @click.stop="emit('toggle-side', node.person.id, 'spouses')" class="side-btn" :class="{ 'active': expandedSideNodes.get(node.person.id)?.spouses }" title="Ehepartner ein-/ausblenden">💍 {{ node.person.spouses.length }}</button>
            <button v-if="node.person.parent_ids.length > 0" @click.stop="emit('toggle-side', node.person.id, 'parents')" class="side-btn" :class="{ 'active': expandedSideNodes.get(node.person.id)?.parents }" title="Eltern ein-/ausblenden">👨‍👩‍👦 {{ node.person.parent_ids.length }}</button>
          </div>
          
          <button v-if="node.children.length > 0 || expandedSideNodes.get(node.person.id)?.spouses || expandedSideNodes.get(node.person.id)?.parents" class="expand-btn expand-child-btn" @click.stop="emit('toggle', node.person.id)">
            {{ expandedNodes.get(node.person.id) ? '▲' : '▼' }}
          </button>
        </div>

        <ul class="cluster-spouses side-list" v-if="node.spouse_nodes && node.spouse_nodes.length > 0">
          <TreeNode 
            v-for="s in node.spouse_nodes" :key="'s-'+s.person.id" :node="s" :selected-id="selectedId"
            :expanded-nodes="expandedNodes" :expanded-side-nodes="expandedSideNodes"
            @select="p => emit('select', p)" @toggle="id => emit('toggle', id)"
            @toggle-side="(id, type) => emit('toggle-side', id, type)" @load-parent="n => emit('load-parent', n)"
            @jump-to="id => emit('jump-to', id)"
          />
        </ul>
      </div>
    </div>

    <!-- 3. KINDER -->
    <ul v-if="expandedNodes.get(node.person.id) && node.children.length > 0 && !node.is_side_branch">
      <TreeNode 
        v-for="child in node.children" :key="child.person.id" :node="child" :selected-id="selectedId"
        :expanded-nodes="expandedNodes" :expanded-side-nodes="expandedSideNodes" :is-root="false"
        @select="p => emit('select', p)" @toggle="(id) => emit('toggle', id)"
        @toggle-side="(id, type) => emit('toggle-side', id, type)" @load-parent="n => emit('load-parent', n)"
        @jump-to="id => emit('jump-to', id)"
      />
    </ul>
  </li>
</template>

<style scoped>
.node-cluster { display: flex; flex-direction: column; align-items: center; position: relative; }
.cluster-main-row { display: flex; align-items: flex-start; gap: 20px; }

/* Side Lists */
.side-list { padding: 0 !important; margin: 0; display: flex; list-style: none; }
.cluster-parents { gap: 15px; margin-bottom: 25px; border-bottom: 2px dashed #bdc3c7; padding-bottom: 15px !important; }
.cluster-spouses { gap: 20px; margin-top: 50px; position: relative; }

/* Baumlinien für Nebenäste entfernen */
li.is-side-branch-node { padding: 0 !important; margin: 0 !important; float: none !important; display: block; }
li.is-side-branch-node::before, li.is-side-branch-node::after { display: none !important; }

/* ROTE LINIEN FÜR EHEPARTNER */
li.is-spouse-node { position: relative; }

li.is-spouse-node::before {
  content: ''; position: absolute;
  top: -25px; 
  left: -20px; 
  width: calc(100% + 20px); 
  border-top: 1.5px solid #e74c3c; z-index: 0;
}
li.is-spouse-node:last-child::before { width: calc(50% + 20px); }

li.is-spouse-node::after {
  content: ''; position: absolute;
  top: -25px; left: 50%;
  height: 25px; 
  border-left: 1.5px solid #e74c3c; z-index: 0;
}

/* INFO-BOX AUF DER ROTEN LINIE */
.marriage-label {
  position: absolute;
  top: -36px; 
  left: 50%; transform: translateX(-50%);
  background: white; border: 1px solid #e74c3c; color: #c0392b;
  font-size: 0.65rem; padding: 2px 6px; border-radius: 4px;
  white-space: nowrap; z-index: 10; text-align: center; line-height: 1.3;
}

/* Karten Design */
.node-card {
  display: inline-block; background: white; border: 2px solid #bdc3c7; padding: 15px 12px 20px 12px;
  border-radius: 8px; min-width: 170px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);
  cursor: pointer; position: relative; z-index: 2; transition: all 0.2s ease;
}
.node-card:hover { border-color: #3498db; }
.node-card.active { border-color: #2980b9; background: #e3f2fd; }
.side-branch-card { background-color: #fcfcfc; border-color: #dcdde1; border-style: dashed; box-shadow: none; }
.node-header { display: flex; flex-direction: column; align-items: center; margin-bottom: 5px; }
.badge { background: #34495e; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-top: 4px; }
.clickable-badge { cursor: pointer; transition: background 0.2s; }
.clickable-badge:hover { background: #e67e22; color: white; }

.dates { font-size: 0.75rem; color: #7f8c8d; margin-bottom: 5px; }
.side-actions { display: flex; justify-content: center; gap: 6px; margin-top: 5px; }
.side-btn { background: #ecf0f1; border: 1px solid #bdc3c7; border-radius: 4px; font-size: 0.75rem; padding: 2px 8px; cursor: pointer; color: #2c3e50; transition: all 0.2s; }
.side-btn:hover { background: #dcdde1; }
.side-btn.active { background: #7f8c8d; color: white; border-color: #7f8c8d; }
.expand-btn { position: absolute; left: 50%; transform: translateX(-50%); background: #ecf0f1; border: 1px solid #bdc3c7; border-radius: 12px; font-size: 0.7rem; padding: 2px 10px; cursor: pointer; color: #2c3e50; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.expand-btn:hover { background: #dcdde1; }
.expand-child-btn { bottom: -12px; }
.expand-parent-btn { top: -12px; }
</style>