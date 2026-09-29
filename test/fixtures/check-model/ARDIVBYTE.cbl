       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARDIVBYTE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-CH               PIC X.
       01 WS-N                PIC 9(9) COMP-5.
       01 WS-K                PIC 9(9) COMP-5.
       01 WS-HEX              PIC X(16) VALUE '0123456789abcdef'.
       01 WS-OUT              PIC X(2).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN(1:1) TO WS-CH
           COMPUTE WS-N = FUNCTION ORD(WS-CH) - 1
           COMPUTE WS-K = WS-N / 16 + 1
           MOVE WS-HEX(WS-K:1) TO WS-OUT(1:1)
           COMPUTE WS-K = FUNCTION MOD(WS-N, 16) + 1
           MOVE WS-HEX(WS-K:1) TO WS-OUT(2:1)
           GOBACK.
