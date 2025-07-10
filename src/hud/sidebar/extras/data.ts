import { FilterValue } from "hud";
import { AbilityItemPF2e, ActorPF2e, MODULE } from "module-helpers";
import { ExtrasActionData, RAW_EXTRAS_ACTIONS, rollRecallKnowledge } from ".";
import { BaseStatisticAction, BaseStatisticRollOptions } from "..";

class ExtraAction extends BaseStatisticAction<ExtrasActionData, AbilityItemPF2e> {
    #filterValue?: FilterValue;
    #label?: string;

    get label(): string {
        return (this.#label ??= game.i18n.localize(`PF2E.Actions.${this.actionKey}.Title`));
    }

    get filterValue(): FilterValue {
        return (this.#filterValue ??= new FilterValue(this.label));
    }

    get isProficient(): boolean {
        return true;
    }

    roll(actor: ActorPF2e, event: MouseEvent, options: BaseStatisticRollOptions) {
        if (this.key === "earnIncome") {
            return game.pf2e.actions.earnIncome(actor);
        }

        if (this.key === "recall-knowledge") {
            return actor.isOfType("creature") && rollRecallKnowledge(actor);
        }

        const rollOptions = {
            ...options,
        };

        if (this.key === "aid") {
            rollOptions.statistic = "perception";
            rollOptions.alternates = true;
        }

        super.roll(actor, event, rollOptions);
    }
}

const _cachedExtrasActions: Collection<ExtraAction> = new Collection();
async function prepareExtrasActions() {
    if (_cachedExtrasActions.size) return;

    for (const data of RAW_EXTRAS_ACTIONS) {
        const sourceItem = await fromUuid<AbilityItemPF2e>(data.sourceId);
        if (!(sourceItem instanceof Item)) return;

        const action = new ExtraAction(data, sourceItem);
        _cachedExtrasActions.set(action.sourceId, action);
    }
}

function getExtrasActions(): Collection<ExtraAction> {
    return _cachedExtrasActions!;
}

function getExtraAction(sourceId: string): ExtraAction | undefined {
    return _cachedExtrasActions.get(sourceId);
}

type ExtractedExtraActionData = Omit<ExtractReadonly<ExtraAction>, "data">;

MODULE.devExpose({ getExtrasActions });

export { getExtraAction, getExtrasActions, prepareExtrasActions };
export type { ExtraAction, ExtractedExtraActionData };
