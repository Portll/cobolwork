       IDENTIFICATION DIVISION.
       PROGRAM-ID. STOPRUN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-N PIC 9 VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM CHECK-PARA.
           DISPLAY 'START'.
           STOP RUN.
           DISPLAY 'AFTER'.
           MOVE 1 TO WS-N.
       CHECK-PARA.
           IF WS-N = 1
               GOBACK
           END-IF.
           DISPLAY 'LIVE'.
       LAST-PARA.
           DISPLAY 'FALLS FROM CHECK-PARA ONLY WHEN PERFORMED: DEAD'.
