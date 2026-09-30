       IDENTIFICATION DIVISION.
       PROGRAM-ID. DECLOOP.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(8192).
       01 WS-BODY             PIC X(8192).
       01 WS-RAW-LEN          PIC 9(5) COMP-5.
       01 WS-END              PIC 9(5) COMP-5.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-BODY
           MOVE 8192 TO WS-RAW-LEN
           PERFORM UNTIL WS-RAW-LEN = 0
               OR WS-BODY(WS-RAW-LEN:1) NOT = SPACE
               SUBTRACT 1 FROM WS-RAW-LEN
           END-PERFORM
           MOVE 1 TO WS-END
           PERFORM UNTIL WS-END > WS-RAW-LEN - 1
               OR WS-BODY(WS-END:2) = "AB"
               ADD 1 TO WS-END
           END-PERFORM
           GOBACK.
       OTHER-PARA.
           MOVE WS-IN(1:4) TO WS-END.
