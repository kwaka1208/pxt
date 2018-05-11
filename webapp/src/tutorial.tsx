/// <reference path="../../built/pxtlib.d.ts" />

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as data from "./data";
import * as sui from "./sui";
import * as sounds from "./sounds";
import * as core from "./core";
import * as md from "./marked";
import * as compiler from "./compiler";

type ISettingsProps = pxt.editor.ISettingsProps;

export function parseTutorialSteps(tutorialId: string, tutorialmd: string) {
    // Download tutorial markdown
    let steps = tutorialmd.split(/^##[^#].*$/gmi);
    let newAuthoring = true;
    if (steps.length <= 1) {
        // try again, using old logic.
        steps = tutorialmd.split(/^###[^#].*$/gmi);
        newAuthoring = false;
    }
    if (steps[0].indexOf("# Not found") == 0) {
        pxt.log(`Tutorial not found: ${tutorialId}`);
        throw new Error(`Tutorial not found: ${tutorialId}`);
    }
    let stepInfo: pxt.editor.TutorialStepInfo[] = [];
    tutorialmd.replace(newAuthoring ? /^##[^#](.*)$/gmi : /^###[^#](.*)$/gmi, (f, s) => {
        let info: pxt.editor.TutorialStepInfo = {
            fullscreen: /@(fullscreen|unplugged)/.test(s),
            unplugged: /@unplugged/.test(s)
        }
        stepInfo.push(info);
        return ""
    });

    if (steps.length < 1) return undefined; // Promise.resolve();
    let options = steps[0];
    steps = steps.slice(1, steps.length); // Remove tutorial title

    for (let i = 0; i < steps.length; i++) {
        const stepContent = steps[i].trim();
        const contentLines = stepContent.split('\n');
        stepInfo[i].headerContentMd = contentLines[0];
        stepInfo[i].contentMd = stepContent;
        stepInfo[i].hasHint = contentLines.length > 1;
    }
    return stepInfo;
}

/**
 * We'll run this step when we first start the tutorial to figure out what blocks are used so we can
 * filter the toolbox. 
 */
export function getUsedBlocksAsync(tutorialId: string, tutorialmd: string): Promise<{ [index: string]: number }> {
    tutorialmd = tutorialmd.replace(/((?!.)\s)+/g, "\n");

    const regex = /```(sim|block|blocks|filterblocks)\s*\n([\s\S]*?)\n```/gmi;
    let match: RegExpExecArray;
    let code = '';
    // Concatenate all blocks in separate code blocks and decompile so we can detect what blocks are used (for the toolbox)
    /* tslint:disable:no-conditional-assignment */
    while ((match = regex.exec(tutorialmd)) != null) {
        code += "\n { \n " + match[2] + "\n } \n";
    }
    /* tslint:enable:no-conditional-assignment */
    return Promise.resolve()
        .then(() => {
            const usedBlocks: { [index: string]: number } = {};

            if (code == '') return Promise.resolve({});
            return compiler.getBlocksAsync()
                .then(blocksInfo => compiler.decompileSnippetAsync(code, blocksInfo))
                .then(blocksXml => {
                    if (blocksXml) {
                        let headless = pxt.blocks.loadWorkspaceXml(blocksXml);
                        let allblocks = headless.getAllBlocks();
                        for (let bi = 0; bi < allblocks.length; ++bi) {
                            let blk = allblocks[bi];
                            usedBlocks[blk.type] = 1;
                        }
                        return usedBlocks;
                    } else {
                        throw new Error("Empty blocksXml, failed to decompile");
                    }
                }).catch(() => {
                    pxt.log(`Failed to decompile tutorial: ${tutorialId}`);
                    throw new Error(`Failed to decompile tutorial: ${tutorialId}`);
                })
        });
}

export class TutorialMenuItem extends data.Component<ISettingsProps, {}> {
    constructor(props: ISettingsProps) {
        super(props);

        this.openTutorialStep = this.openTutorialStep.bind(this);
    }

    openTutorialStep(step: number) {
        let options = this.props.parent.state.tutorialOptions;
        options.tutorialStep = step;
        pxt.tickEvent(`tutorial.step`, { tutorial: options.tutorial, step: step }, { interactiveConsent: true });
        this.props.parent.setTutorialStep(step);
    }

    renderCore() {
        const { tutorialReady, tutorialStepInfo, tutorialStep } = this.props.parent.state.tutorialOptions;
        const currentStep = tutorialStep;
        if (!tutorialReady) return <div />;

        return <div className="ui item">
            <div className="ui item tutorial-menuitem" role="menubar">
                {tutorialStepInfo.map((step, index) =>
                    (index == currentStep) ?
                        <span className="step-label" key={'tutorialStep' + index}>
                            <TutorialMenuItemLink index={index}
                                className={`ui circular label ${currentStep == index ? 'blue selected' : 'inverted'} ${!tutorialReady ? 'disabled' : ''}`}
                                ariaLabel={lf("Tutorial step {0}. This is the current step", index + 1)}
                                onClick={this.openTutorialStep}>{index + 1}</TutorialMenuItemLink>
                        </span> :
                        <span className="step-label" key={'tutorialStep' + index} data-tooltip={`${index + 1}`} data-inverted="" data-position="bottom center">
                            <TutorialMenuItemLink index={index}
                                className={`ui empty circular label ${!tutorialReady ? 'disabled' : ''} clear`}
                                ariaLabel={lf("Tutorial step {0}", index + 1)}
                                onClick={this.openTutorialStep} />
                        </span>
                )}
            </div>
        </div>;
    }
}

interface TutorialMenuItemLinkProps {
    index: number;
    className: string;
    ariaLabel: string;
    onClick: (index: number) => void;
}

export class TutorialMenuItemLink extends data.Component<TutorialMenuItemLinkProps, {}> {

    handleClick = () => {
        this.props.onClick(this.props.index);
    }

    renderCore() {
        const { className, ariaLabel, index } = this.props;
        return <a className={className} role="menuitem" aria-label={ariaLabel} tabIndex={0} onClick={this.handleClick} onKeyDown={sui.fireClickOnEnter}>
            {this.props.children}
        </a>;
    }
}

export interface TutorialHintState {
    visible: boolean;
}

export class TutorialHint extends data.Component<ISettingsProps, TutorialHintState> {

    constructor(props: ISettingsProps) {
        super(props);
    }

    showHint() {
        this.setState({ visible: true })
    }

    renderCore() {
        const { visible } = this.state;
        const options = this.props.parent.state.tutorialOptions;
        const { tutorialReady, tutorialStepInfo, tutorialStep, tutorialName } = options;
        if (!tutorialReady) return <div />;

        const step = tutorialStepInfo[tutorialStep];
        const tutorialHint = step.contentMd;
        const tutorialFullscreen = step.fullscreen;
        const tutorialUnplugged = !!step.unplugged && tutorialStep < tutorialStepInfo.length - 1;

        const header = tutorialFullscreen ? tutorialName : lf("Hint");

        const hide = () => this.setState({ visible: false });
        const next = () => {
            hide();
            const nextStep = tutorialStep + 1;
            options.tutorialStep = nextStep;
            pxt.tickEvent(`tutorial.hint.next`, { tutorial: options.tutorial, step: nextStep });
            this.props.parent.setTutorialStep(nextStep);
        }

        const isRtl = pxt.Util.isUserLanguageRtl();
        const actions: sui.ModalButton[] = [{
            label: lf("Ok"),
            onclick: tutorialUnplugged ? next : hide,
            icon: 'check',
            className: 'green'
        }]

        return <sui.Modal isOpen={visible} className="hintdialog"
            closeIcon={true} header={header} buttons={actions}
            onClose={tutorialUnplugged ? next : hide} dimmer={true} longer={true}
            closeOnDimmerClick closeOnDocumentClick closeOnEscape>
            <md.MarkedContent markdown={tutorialHint} parent={this.props.parent} />
        </sui.Modal>;
    }
}

interface TutorialCardState {
    popout?: boolean;
}

export class TutorialCard extends data.Component<ISettingsProps, TutorialCardState> {
    public focusInitialized: boolean;

    constructor(props: ISettingsProps) {
        super(props);
        this.state = {
        }

        this.showHint = this.showHint.bind(this);
        this.closeLightbox = this.closeLightbox.bind(this);
        this.tutorialCardKeyDown = this.tutorialCardKeyDown.bind(this);
        this.okButtonKeyDown = this.okButtonKeyDown.bind(this);
        this.previousTutorialStep = this.previousTutorialStep.bind(this);
        this.nextTutorialStep = this.nextTutorialStep.bind(this);
        this.finishTutorial = this.finishTutorial.bind(this);
    }

    previousTutorialStep() {
        let options = this.props.parent.state.tutorialOptions;
        const currentStep = options.tutorialStep;
        const previousStep = currentStep - 1;

        options.tutorialStep = previousStep;

        pxt.tickEvent(`tutorial.previous`, { tutorial: options.tutorial, step: previousStep }, { interactiveConsent: true });
        this.props.parent.setTutorialStep(previousStep);
    }

    nextTutorialStep() {
        let options = this.props.parent.state.tutorialOptions;
        const currentStep = options.tutorialStep;
        const nextStep = currentStep + 1;

        options.tutorialStep = nextStep;

        pxt.tickEvent(`tutorial.next`, { tutorial: options.tutorial, step: nextStep }, { interactiveConsent: true });
        this.props.parent.setTutorialStep(nextStep);
    }

    finishTutorial() {
        this.closeLightbox();
        this.props.parent.completeTutorial();
    }

    private closeLightboxOnEscape = (e: KeyboardEvent) => {
        const charCode = core.keyCodeFromEvent(e);
        if (charCode === 27) {
            this.closeLightbox();
        }
    }

    setPopout() {
        this.setState({ popout: true });
    }

    private closeLightbox() {
        sounds.tutorialNext();
        document.documentElement.removeEventListener("keydown", this.closeLightboxOnEscape);

        // Hide lightbox
        this.props.parent.hideLightbox();
        this.setState({ popout: false });
    }

    componentWillUpdate() {
        document.documentElement.addEventListener("keydown", this.closeLightboxOnEscape);
    }

    private tutorialCardKeyDown(e: KeyboardEvent) {
        const charCode = core.keyCodeFromEvent(e);
        if (charCode == core.TAB_KEY) {
            e.preventDefault();
            const tutorialOkRef = this.refs["tutorialok"] as sui.Button;
            const okButton = ReactDOM.findDOMNode(tutorialOkRef) as HTMLElement;
            okButton.focus();
        }
    }

    private okButtonKeyDown(e: KeyboardEvent) {
        const charCode = core.keyCodeFromEvent(e);
        if (charCode == core.TAB_KEY) {
            e.preventDefault();
            const tutorialCard = this.refs['tutorialmessage'] as HTMLElement;
            tutorialCard.focus();
        }
    }

    componentDidUpdate(prevProps: ISettingsProps, prevState: TutorialCardState) {
        const tutorialCard = this.refs['tutorialmessage'] as HTMLElement;
        const tutorialOkRef = this.refs["tutorialok"] as sui.Button;
        const okButton = ReactDOM.findDOMNode(tutorialOkRef) as HTMLElement;
        if (prevState.popout != this.state.popout && this.state.popout) {
            // Setup focus trap around the tutorial card and the ok button
            tutorialCard.addEventListener('keydown', this.tutorialCardKeyDown);
            okButton.addEventListener('keydown', this.okButtonKeyDown);
            tutorialCard.focus();
        } else if (prevState.popout != this.state.popout && !this.state.popout) {
            // Unregister event handlers
            tutorialCard.removeEventListener('keydown', this.tutorialCardKeyDown);
            okButton.removeEventListener('keydown', this.okButtonKeyDown);
            tutorialCard.focus();
        }
    }

    componentWillUnmount() {
        // Clear the markdown cache when we unmount
        md.MarkedContent.clearBlockSnippetCache();
    }

    private hasHint() {
        const options = this.props.parent.state.tutorialOptions;
        const { tutorialReady, tutorialStepInfo, tutorialStep } = options;
        if (!tutorialReady) return false;
        return tutorialStepInfo[tutorialStep].hasHint;
    }

    showHint() {
        if (!this.hasHint()) return;
        this.closeLightbox();
        this.props.parent.showTutorialHint();
    }

    renderCore() {
        const options = this.props.parent.state.tutorialOptions;
        const { tutorialReady, tutorialStepInfo, tutorialStep } = options;
        if (!tutorialReady) return <div />
        const tutorialCardContent = tutorialStepInfo[tutorialStep].headerContentMd;
        let tutorialAriaLabel = '';

        const currentStep = tutorialStep;
        const maxSteps = tutorialStepInfo.length;
        const hasPrevious = tutorialReady && currentStep != 0;
        const hasNext = tutorialReady && currentStep != maxSteps - 1;
        const hasFinish = currentStep == maxSteps - 1;
        const hasHint = this.hasHint();

        if (hasHint) {
            tutorialAriaLabel += lf("Press Space or Enter to show a hint.");
        }

        const isRtl = pxt.Util.isUserLanguageRtl();
        return <div id="tutorialcard" className={`ui ${tutorialReady ? 'tutorialReady' : ''}`} >
            <div className='ui buttons'>
                {hasPrevious ? <sui.Button icon={`${isRtl ? 'right' : 'left'} chevron`} className={`prevbutton left attached green ${!hasPrevious ? 'disabled' : ''}`} text={lf("Back")} textClass="landscape only" ariaLabel={lf("Go to the previous step of the tutorial.")} onClick={this.previousTutorialStep} onKeyDown={sui.fireClickOnEnter} /> : undefined}
                <div className="ui segment attached tutorialsegment">
                    <div role="button" className='avatar-image' onClick={this.showHint} onKeyDown={sui.fireClickOnEnter}></div>
                    {hasHint ? <sui.Button className="mini blue hintbutton hidelightbox" text={lf("Hint")} tabIndex={-1} onClick={this.showHint} onKeyDown={sui.fireClickOnEnter} /> : undefined}
                    <div ref="tutorialmessage" className={`tutorialmessage`} role="alert" aria-label={tutorialAriaLabel} tabIndex={hasHint ? 0 : -1}
                        onClick={this.showHint} onKeyDown={sui.fireClickOnEnter}>
                        <div className="content">
                            <md.MarkedContent markdown={tutorialCardContent} parent={this.props.parent} />
                        </div>
                    </div>
                    <sui.Button ref="tutorialok" id="tutorialOkButton" className="large green okbutton showlightbox" text={lf("Ok")} onClick={this.closeLightbox} onKeyDown={sui.fireClickOnEnter} />
                </div>
                {hasNext ? <sui.Button icon={`${isRtl ? 'left' : 'right'} chevron`} rightIcon className={`nextbutton right attached green ${!hasNext ? 'disabled' : ''}`} text={lf("Next")} textClass="landscape only" ariaLabel={lf("Go to the next step of the tutorial.")} onClick={this.nextTutorialStep} onKeyDown={sui.fireClickOnEnter} /> : undefined}
                {hasFinish ? <sui.Button icon="left checkmark" className={`orange right attached ${!tutorialReady ? 'disabled' : ''}`} text={lf("Finish")} ariaLabel={lf("Finish the tutorial.")} onClick={this.finishTutorial} onKeyDown={sui.fireClickOnEnter} /> : undefined}
            </div>
        </div>;
    }
}