       IDENTIFICATION DIVISION.
       PROGRAM-ID. SUBPG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-KEPT            PIC X(40).
       LINKAGE SECTION.
       01 LK-A               PIC X(40).
       PROCEDURE DIVISION USING LK-A.
           IF WS-KEPT = SPACES
               MOVE LK-A TO WS-KEPT
           ELSE
               MOVE WS-KEPT TO LK-A
           END-IF
           GOBACK.
