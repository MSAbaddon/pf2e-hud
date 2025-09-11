import {
    createSlider,
    FilterValue,
    isAnimistEntry,
    isFocusCantrip,
    processSliderEvent,
    SidebarPF2eHUD,
    SliderData,
} from "hud";
import {
    ActiveSpell,
    addListenerAll,
    ApplicationRenderOptions,
    ConsumablePF2e,
    CreaturePF2e,
    dataToDatasetString,
    getEquipAnnotation,
    localeCompare,
    OneToTen,
    R,
    SpellcastingCategory,
    SpellcastingSheetData,
    SpellcastingSlotGroup,
    SpellPF2e,
    spellSlotGroupIdToNumber,
    ValueAndMax,
} from "module-helpers";
import { SlotSpellData, SPELL_CATEGORIES, SpellCategoryType, SpellSidebarItem } from ".";

class SpellsSidebarPF2eHUD extends SidebarPF2eHUD<SpellPF2e, SpellSidebarItem> {
    get name(): "spells" {
        return "spells";
    }

    getSidebarItemKey({ itemId, groupId, slotId = "x" }: DOMStringMap): string | undefined {
        return itemId && groupId ? `${itemId}-${groupId}-${slotId}` : itemId;
    }

    protected async _prepareContext(options: ApplicationRenderOptions): Promise<SpellsHudContext> {
        return getSpellcastingData.call(this);
    }

    protected _onClickAction(event: PointerEvent, target: HTMLElement) {
        const action = target.dataset.action as EventAction;

        if (action === "slider") {
            return processSliderEvent(event, target, this.#onSlider.bind(this));
        }

        if (event.button !== 0) return;

        if (action === "dailies-retrain") {
            return game.dailies?.api.retrainFromElement(this.actor, target);
        }

        const sidebarItem = this.getSidebarItemFromElement(target);
        if (!sidebarItem) return;

        if (action === "cast-spell") {
            sidebarItem.cast();
        } else if (action === "draw-item") {
            sidebarItem.drawItem();
        } else if (action === "toggle-signature") {
            sidebarItem.toggleSignature();
        } else if (action === "toggle-slot-expended") {
            sidebarItem.toggleSlotExpended();
        }
    }

    protected _activateListeners(html: HTMLElement): void {
        const actor = this.actor;

        if (actor.isOfType("character") && game.dailies?.active) {
            addListenerAll(
                html,
                "[data-action='update-staff-charges']",
                "change",
                (el: HTMLInputElement) => {
                    game.dailies?.api.setStaffChargesValue(actor, el.valueAsNumber);
                }
            );
        }
    }

    #onSlider(action: "focus", direction: 1 | -1) {
        if (action === "focus") {
            const actor = this.actor;
            if (!actor.isOfType("character", "npc")) return;

            const focusPoints = actor.system.resources.focus;
            const newValue = Math.clamp(focusPoints.value + direction, 0, focusPoints.max);

            if (newValue !== focusPoints.value) {
                actor.update({ "system.resources.focus.value": newValue });
            }
        }
    }
}

async function getSpellcastingData(this: SpellsSidebarPF2eHUD): Promise<SpellsHudContext> {
    const actor = this.actor;
    const spellcastingEntries = actor.spellcasting.collections.map(async (spells) => {
        const entry = spells.entry;
        const data = (await entry.getSheetData({ spells })) as CustomSpellcastingEntry;

        data.isAnimist = isAnimistEntry(entry);

        return data;
    });

    const spellGroups: SpellGroupData[] = [];
    const dailiesActive = !!game.dailies?.active;
    const canUseCharges = dailiesActive;
    const focusPool = createSlider("focus", actor.system.resources?.focus ?? { value: 0, max: 0 });

    const vesselsData = (dailiesActive && game.dailies?.api.getAnimistVesselsData(actor)) || {
        entry: undefined,
        primary: [] as string[],
    };

    for (const entry of await Promise.all(spellcastingEntries)) {
        if (!entry.groups.length) continue;

        const entryId = entry.id;
        const entryData = R.omit(entry, ["category", "groups", "id", "statistic", "uses"]);
        const isCharges = entry.category === "charges";
        const isVessel = entry.id === vesselsData.entry?.id;

        const item = entry.isEphemeral
            ? actor.items.get<ConsumablePF2e<CreaturePF2e>>(entry.id.split("-")[0])
            : undefined;

        const [categoryType, consumable] =
            entry.category === "items" && item
                ? [item.category, item]
                : [
                      entry.isFlexible ? "flexible" : entry.isStaff ? "staff" : entry.category,
                      undefined,
                  ];

        const category = SPELL_CATEGORIES[categoryType as SpellCategoryType];
        if (!category) continue;

        const entryDc = entry.statistic?.dc.value;
        const entryDcLabel = entryDc
            ? game.i18n.format("PF2E.DCWithValue", { dc: entryDc, text: "" })
            : "";
        const entryLabel = game.i18n.localize(category.label);
        const entryTooltip = entryDcLabel
            ? `${entryLabel} - ${entryDcLabel}<br>${entry.name}`
            : `${entryLabel}<br>${entry.name}`;

        const annotationData = entry.isStaff || consumable ? getEquipAnnotation(item) : undefined;
        const annotation = annotationData
            ? {
                  ...annotationData,
                  dataset: dataToDatasetString(
                      R.pick(annotationData, ["carryType", "cost", "fullAnnotation", "handsHeld"])
                  ),
              }
            : undefined;

        for (const group of entry.groups) {
            if (!group.active.length || group.uses?.max === 0) continue;

            const slotSpells: SpellSidebarItem[] = [];
            const groupNumber = spellSlotGroupIdToNumber(group.id);
            const isCantrip = group.id === "cantrips";
            const isBroken = !isCantrip && isCharges && !canUseCharges;
            const focusExpended = !isCantrip && focusPool.value <= 0;
            const groupUses = R.isNumber(group.uses?.value)
                ? (group.uses as ValueAndMax)
                : undefined;

            const getUses = (active: CustomGroupActive): SpellSidebarItem["uses"] | undefined => {
                if (
                    isCantrip ||
                    entry.isFocusPool ||
                    consumable ||
                    (entry.isPrepared && !entry.isFlexible)
                )
                    return;

                const uses = isCharges && !isBroken ? entry.uses : active.uses ?? groupUses;
                if (!uses) return;

                const input = entry.isStaff
                    ? ""
                    : isCharges
                    ? "system.slots.slot1.value"
                    : entry.isInnate
                    ? "system.location.uses.value"
                    : `system.slots.slot${groupNumber}.value`;

                return {
                    ...uses,
                    hasMaxUses: !!uses.max && !entry.isStaff,
                    input,
                    itemId: entry.isStaff ? "" : entry.isInnate ? active.spell.id : entry.id,
                };
            };

            for (let slotId = 0; slotId < group.active.length; slotId++) {
                const active = group.active[slotId];
                if (!active?.spell || active.uses?.max === 0) continue;

                const spell = active.spell as SpellPF2e<CreaturePF2e>;
                const expended = entry.isFocusPool ? focusExpended : active.expended;
                const isVirtual = entry.isSpontaneous && !isCantrip && active.virtual;
                const signature =
                    entry.isAnimist && !isCantrip && !isVirtual
                        ? { toggled: active.signature }
                        : undefined;

                const untrainedVesselBtn =
                    isVessel && !vesselsData.primary.includes(spell.id)
                        ? game.dailies?.api.createRetrainBtn(actor, spell.id, "vessel")
                        : undefined;

                const spellData: SlotSpellData = {
                    ...entryData,
                    annotation,
                    canTogglePrepared: entry.isPrepared && !isCantrip,
                    castRank: (active.castRank ?? spell.rank) as OneToTen,
                    category,
                    categoryType: categoryType as SpellCategoryType,
                    disabled: expended || isBroken || !!untrainedVesselBtn,
                    entryId,
                    entryTooltip,
                    expended,
                    groupId: group.id,
                    isBroken,
                    isVessel,
                    isVirtual,
                    parentId: item?.id,
                    signature,
                    slotId,
                    spell,
                    untrainedVessel: untrainedVesselBtn?.outerHTML,
                    uses: getUses(active),
                };

                const sidebarSpell = this.addSidebarItem(
                    SpellSidebarItem,
                    `${spell.id}-${group.id}-${entry.isPrepared ? slotId : "x"}`,
                    spellData
                );
                slotSpells.push(sidebarSpell);
            }

            if (slotSpells.length) {
                const isFocusGroup = entry.isFocusPool && !isCantrip;
                const groupRank = isFocusGroup ? 12 : entry.isRitual ? 13 : groupNumber;

                const spellsGroup = (spellGroups[groupRank] ??= {
                    filterValue: new FilterValue(),
                    focusPool: isFocusGroup ? focusPool : null,
                    label: isFocusGroup
                        ? "PF2E.Focus.Spells"
                        : entry.isRitual
                        ? "PF2E.Actor.Character.Spellcasting.Tab.Rituals"
                        : group.label,
                    slotSpells: [],
                });

                if (groupRank === 0 && entry.isFocusPool && hasFocustCantrip(slotSpells)) {
                    spellsGroup.focusPool = focusPool;
                }

                spellsGroup.filterValue.add(...slotSpells);
                spellsGroup.slotSpells.push(...slotSpells);
            }
        }
    }

    for (let i = 0; i < spellGroups.length; i++) {
        const group = spellGroups[i];

        if (group && i <= 11) {
            group.slotSpells.sort((a: SpellSidebarItem, b: SpellSidebarItem) => {
                return localeCompare(a.name, b.name);
            });
        }
    }

    return {
        spellGroups,
    };
}

function hasFocustCantrip(spells: SpellSidebarItem[]) {
    return spells.some(({ spell }) => isFocusCantrip(spell));
}

interface SpellsSidebarPF2eHUD {
    get actor(): CreaturePF2e;
}

type EventAction =
    | "cast-spell"
    | "dailies-retrain"
    | "draw-item"
    | "slider"
    | "toggle-signature"
    | "toggle-slot-expended";

type SpellGroupData = {
    label: string;
    focusPool: SliderData | null;
    filterValue: FilterValue;
    slotSpells: SpellSidebarItem[];
};

type CustomSpellcastingEntry = Omit<SpellcastingSheetData, "category" | "groups"> & {
    isAnimist?: boolean;
    category: SpellcastingCategory | "charges";
    isStaff: boolean;
    uses?: ValueAndMax;
    groups: Array<
        Omit<SpellcastingSlotGroup, "active"> & {
            active: (CustomGroupActive | null)[];
        }
    >;
};

type CustomGroupActive = ActiveSpell & { uses?: ValueAndMax };

type SpellsHudContext = {
    spellGroups: SpellGroupData[];
};

export { SpellsSidebarPF2eHUD };
export type { CustomSpellcastingEntry };
