"use client";

import { Dispatch, SetStateAction, useEffect, useState } from "react";
import * as speech from 'microsoft-cognitiveservices-speech-sdk';
import { NodeData, NodeType } from "./tree/types";

export const Voice = ({nodes, setNodes}: {nodes: NodeData[], setNodes: Dispatch<SetStateAction<NodeData[]>>}) => {
    const [token, setToken] = useState<null | string>(null);
    const [recording, setRecording] = useState(false);
    const [currentPhrase, setCurrentPhrase] = useState('');

    useEffect(() => {
        if (!token) {
            // TODO: Call this from the server - JMW
            fetch(`https://${process.env.NEXT_PUBLIC_SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {method: 'POST', headers: {
                'Ocp-Apim-Subscription-Key': process.env.NEXT_PUBLIC_SPEECH_KEY || '',
                'Content-Type': 'application/x-www-form-urlencoded'
            }}).then(i => i.text()).then(i => setToken(i));
        }
    }, [token])

    const toggleRecording = () => {
        setRecording(!recording);
    };

    useEffect(() => {
        if (!token) { 
            setRecording(false);
            return;
        }
        const speechConfig = speech.SpeechConfig.fromAuthorizationToken(token, process.env.NEXT_PUBLIC_SPEECH_REGION || '');
        const audioConfig = speech.AudioConfig.fromDefaultMicrophoneInput();
        const recognizer = new speech.SpeechRecognizer(speechConfig, audioConfig);
        if (recording) {
            let currentOffset: number | null = null;
            recognizer.startContinuousRecognitionAsync(() => setCurrentPhrase('listening...'));
            recognizer.recognizing = function (s: speech.Recognizer, e: speech.SpeechRecognitionEventArgs) {
                setCurrentPhrase(e.result.text);
                // console.log("Duration in Ticks: " + e.result.duration);
                if (e.result.offset !== currentOffset) {
                    // A new phrase
                    setNodes(oldNodes => {
                        console.log('SETTING NODES')
                        oldNodes.push({ id: 2, label: "Chicken", type: NodeType.idea, parent: 1 });
                        return oldNodes;
                    })
                }
                currentOffset = e.result.offset;
            };
        }
        if (!recording) {
            recognizer.stopContinuousRecognitionAsync(() => setCurrentPhrase(''));
        }
    }, [recording])

    return (
        <div className="flex gap-2 fixed bottom-4 left-4">
            <button
                onClick={toggleRecording}
                className={`${recording ? 'text-red-600' : ''} hover:opacity-80`}
            >
                <i className="fas fa-microphone"></i>
            </button>
            {recording && (
                <div className="text-gray-400 italic">
                    {currentPhrase}
                </div>
            )}

        </div>
    );
};
