       PROCESS TRUNC(OPT)
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TRUNCARITH.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-CTR     PIC 9(4) COMP.
       01 WS-BIG     PIC 9(8).
       01 WS-A       PIC 9(3).
       01 WS-B       PIC 9(3).
       PROCEDURE DIVISION.
           ADD 1 TO WS-CTR
           ADD WS-BIG TO WS-CTR
           COMPUTE WS-CTR = WS-A * WS-B
             ON SIZE ERROR MOVE 0 TO WS-CTR
           END-COMPUTE
           COMPUTE WS-CTR = WS-A * WS-B
           GOBACK.
